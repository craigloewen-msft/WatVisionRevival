import os
import time
import json
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from flask_socketio import SocketIO
from msrest.authentication import CognitiveServicesCredentials
from werkzeug.utils import secure_filename

import cv2
import numpy as np
import torch
import tqdm

import base64

from PIL import Image
import io

from modules.xfeat import XFeat
import matplotlib.pyplot as plt

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from vision_instance import VisionInstance

from openai import AzureOpenAI

from matching_service import MatchingService

from typing import Dict

import asyncio

class VisionManager:
    def __init__(self, socketio: SocketIO):
        self.azure_vision_key = os.getenv('AZURE_VISION_KEY')
        self.azure_vision_endpoint = os.getenv('AZURE_VISION_ENDPOINT')
        self.azure_llm_key = os.getenv('AZURE_LLM_KEY')
        self.azure_llm_endpoint = os.getenv('AZURE_LLM_ENDPOINT')

        if not self.azure_vision_key or not self.azure_vision_endpoint or not self.azure_llm_key or not self.azure_llm_endpoint:
            raise ValueError('Env variables must be set')

        self.computer_vision_client = ComputerVisionClient(
            self.azure_vision_endpoint, CognitiveServicesCredentials(self.azure_vision_key)
        )

        self.llm_client = AzureOpenAI(
            api_key=self.azure_llm_key,
            api_version="2025-01-01-preview",
            base_url=self.azure_llm_endpoint,
        )
        
        self.matching_service = MatchingService()

        self.socketio = socketio

        base_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
        options = vision.HandLandmarkerOptions(base_options=base_options,
                                               min_hand_detection_confidence=0.01,
                                                  min_hand_presence_confidence=0.01,
                                                  running_mode=vision.RunningMode.IMAGE,
                                            num_hands=1)
        self.hands_detector = vision.HandLandmarker.create_from_options(options)

        self.visionInstanceList: Dict[str, VisionInstance] = {}

    def __get_cv_image_from_input(self, input_image):
        # Convert the input image to a format OpenCV can process directly
        image_bytes = input_image.read()  # Read the image bytes from the input
        np_array = np.frombuffer(image_bytes, np.uint8)  # Convert bytes to a NumPy array
        input_image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)  # Decode the image

        if input_image is None:
            raise ValueError("Source image could not be loaded")

        converted_image = cv2.cvtColor(input_image, cv2.COLOR_BGR2RGB)

        return converted_image

    def set_source_image(self, session_id, source):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        source_image = self.__get_cv_image_from_input(source)
        
        # Create a directory for uploaded images if it doesn't exist
        upload_dir = '/tmp/'
        
        # Generate a secure filename and save the image to disk
        filename = secure_filename(source.filename)
        filepath = os.path.join(upload_dir, filename)
        
        # Convert RGB back to BGR for saving with cv2
        source_image_bgr = cv2.cvtColor(source_image, cv2.COLOR_RGB2BGR)
        cv2.imwrite(filepath, source_image_bgr)

        # TODO add code to fix handling the image

        # Set the source image in the VisionInstance with the file path
        return self.visionInstanceList[session_id].set_source_image(source_image, filepath)

    
    def step(self, session_id, input_image):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        input_image = self.__get_cv_image_from_input(input_image)

        input_image, source_image, text_under_finger = self.visionInstanceList[session_id].step(input_image)

        # Convert np.ndarray to base64-encoded strings
        _, input_image_encoded = cv2.imencode('.jpg', input_image)
        _, source_image_encoded = cv2.imencode('.jpg', source_image)

        input_image_base64 = base64.b64encode(input_image_encoded).decode('utf-8')
        source_image_base64 = base64.b64encode(source_image_encoded).decode('utf-8')

        # Return as JSON-serializable dictionary
        return {
            "input_image": input_image_base64,
            "source_image": source_image_base64,
            "text_under_finger": text_under_finger
        }
    
    def get_current_image_description(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return self.visionInstanceList[session_id].get_current_image_description()
    
    def add_connection(self, session_id):
        if session_id in self.visionInstanceList:
            raise ValueError(f"Session {session_id} already exists")
        
        # Create a new VisionInstance for the session
        self.visionInstanceList[session_id] = VisionInstance(
            self.hands_detector,
            self.computer_vision_client,
            self.llm_client,
            self.matching_service,
            session_id,
            self.socketio
        )
        
        return True
    
    def remove_connection(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")
        
        # Clean up the VisionInstance
        del self.visionInstanceList[session_id]
        
        return True
    
    def start_recognition(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")
            
        return self.visionInstanceList[session_id].start_recognition()
    
    def stop_recognition(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return self.visionInstanceList[session_id].stop_recognition()
    
    def process_audio_chunk(self, session_id, audio_data):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return self.visionInstanceList[session_id].process_audio_chunk(audio_data)