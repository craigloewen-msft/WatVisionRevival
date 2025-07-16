import asyncio
import os
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

from fastapi import WebSocket

import cv2
import numpy as np

import base64

from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from vision_instance import VisionInstance

from openai import AzureOpenAI

from matching_service import MatchingService

from typing import Dict

import time

class VisionManager:
    def __init__(self):
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

        base_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
        options = vision.HandLandmarkerOptions(base_options=base_options,
                                               min_hand_detection_confidence=0.01,
                                                  min_hand_presence_confidence=0.01,
                                                  running_mode=vision.RunningMode.IMAGE,
                                            num_hands=1)
        self.hands_detector = vision.HandLandmarker.create_from_options(options)

        self.visionInstanceList: Dict[str, VisionInstance] = {}

        self.running_step_tasks = {}

    def __get_cv_image_from_input(self, input_image):
        # Convert the input image to a format OpenCV can process directly
        image_bytes = input_image.read()  # Read the image bytes from the input
        np_array = np.frombuffer(image_bytes, np.uint8)  # Convert bytes to a NumPy array
        input_image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)  # Decode the image

        if input_image is None:
            raise ValueError("Source image could not be loaded")

        converted_image = cv2.cvtColor(input_image, cv2.COLOR_BGR2RGB)

        return converted_image

    async def set_source_image(self, session_id, source):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        # source is in bytes format convert to cv2 image
        source_image = cv2.imdecode(np.frombuffer(source, np.uint8), cv2.IMREAD_COLOR)

        # Save source image to /tmp directory
        filepath = f"/tmp/source_image_{session_id}.jpg"
        if not os.path.exists('/tmp'):
            os.makedirs('/tmp')
        cv2.imwrite(filepath, source_image)
        
        # TODO add code to fix handling the image

        # Set the source image in the VisionInstance with the file path
        return await self.visionInstanceList[session_id].set_source_image(source_image, filepath)

    
    async def step(self, session_id, input_data):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")
        
        if self.visionInstanceList[session_id].step_task is not None:
            return
        
        async def run_step_task():
            try:
                start_time = time.time()
                await self.visionInstanceList[session_id].step(input_data)
                end_time = time.time()
                execution_time = end_time - start_time
                print(f"Step execution time for session {session_id}: {execution_time:.4f} seconds")
            except Exception as e:
                raise e
            finally: 
                self.visionInstanceList[session_id].step_task = None

        task = asyncio.create_task(run_step_task())
        self.visionInstanceList[session_id].step_task = task

    async def get_screen_info(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return self.visionInstanceList[session_id].get_current_image_description()
    
    def add_connection(self, session_id, websocket: WebSocket):
        if session_id in self.visionInstanceList:
            raise ValueError(f"Session {session_id} already exists")
        
        # Create a new VisionInstance for the session
        self.visionInstanceList[session_id] = VisionInstance(
            self.hands_detector,
            self.computer_vision_client,
            self.llm_client,
            self.matching_service,
            session_id,
            websocket
        )
        
        return True
    
    async def remove_connection(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")
        
        # Clean up the VisionInstance
        await self.visionInstanceList[session_id].stop_session()
        del self.visionInstanceList[session_id]
        
        return True
    
    async def start_session(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")
            
        return await self.visionInstanceList[session_id].start_session()
    
    async def stop_session(self, session_id):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return await self.visionInstanceList[session_id].stop_session()
    
    async def process_audio_chunk(self, session_id, audio_data):
        if session_id not in self.visionInstanceList:
            raise ValueError(f"Session {session_id} not found")

        return await self.visionInstanceList[session_id].process_audio_chunk(audio_data)