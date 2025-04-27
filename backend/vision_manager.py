import os
import time
import json
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
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

class VisionManager:
    def __init__(self, app):
        self.azure_vision_key = os.getenv('AZURE_VISION_KEY')
        self.azure_vision_endpoint = os.getenv('AZURE_VISION_ENDPOINT')

        if not self.azure_vision_key or not self.azure_vision_endpoint:
            raise ValueError('AZURE_VISION_KEY and AZURE_VISION_ENDPOINT must be set in the environment variables')

        self.computer_vision_client = ComputerVisionClient(
            self.azure_vision_endpoint, CognitiveServicesCredentials(self.azure_vision_key)
        )

        base_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
        options = vision.HandLandmarkerOptions(base_options=base_options,
                                               min_hand_detection_confidence=0.01,
                                                  min_hand_presence_confidence=0.01,
                                                  running_mode=vision.RunningMode.IMAGE,
                                            num_hands=1)
        detector = vision.HandLandmarker.create_from_options(options)

        self.visionInstanceList = [ VisionInstance(detector) ]

    def __get_cv_image_from_input(self, input_image):
        # Convert the input image to a format OpenCV can process directly
        image_bytes = input_image.read()  # Read the image bytes from the input
        np_array = np.frombuffer(image_bytes, np.uint8)  # Convert bytes to a NumPy array
        input_image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)  # Decode the image

        if input_image is None:
            raise ValueError("Source image could not be loaded")

        converted_image = cv2.cvtColor(input_image, cv2.COLOR_BGR2RGB)

        return converted_image

    def set_source_image(self, source):
        source_image = self.__get_cv_image_from_input(source)

        # Set the source image in the VisionInstance
        return self.visionInstanceList[0].set_source_image(source_image)
    
    def step(self, input_image):

        input_image = self.__get_cv_image_from_input(input_image)

        input_image, source_image, text_under_finger = self.visionInstanceList[0].step(input_image)

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