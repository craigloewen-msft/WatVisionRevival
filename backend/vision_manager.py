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

from PIL import Image
import io

from modules.xfeat import XFeat

class VisionManager:
    def __init__(self, app):
        self.azure_vision_key = os.getenv('AZURE_VISION_KEY')
        self.azure_vision_endpoint = os.getenv('AZURE_VISION_ENDPOINT')

        if not self.azure_vision_key or not self.azure_vision_endpoint:
            raise ValueError('AZURE_VISION_KEY and AZURE_VISION_ENDPOINT must be set in the environment variables')

        self.computer_vision_client = ComputerVisionClient(
            self.azure_vision_endpoint, CognitiveServicesCredentials(self.azure_vision_key)
        )

        data_path = os.path.join(os.path.dirname(__file__), 'test_data_video.json')
        with open(data_path, 'r') as file:
            self.test_data = json.load(file)

        self.xfeat = XFeat()

    def get_text_info(self, input_image):
        # Input is expected to be a file-like object with 'mimetype' and 'buffer' attributes
        # Uncomment and implement the following code to use Azure Computer Vision API
        # try:
        #     result = self.computer_vision_client.read_in_stream(input_image.buffer, language='en')
        #     operation = result.operation_location.split('/')[-1]
        #
        #     while True:
        #         result = self.computer_vision_client.get_read_result(operation)
        #         if result.status == "succeeded":
        #             break
        #         time.sleep(1)
        #
        #     return result.analyze_result
        # except Exception as error:
        #     print(f"Error analyzing image: {error}")
        #     return None

        return self.test_data

    def get_homography(self, input_image_path, source_image_path):

        # Load images
        input_image = cv2.imread(input_image_path)
        source_image = cv2.imread(source_image_path)

        if input_image is None or source_image is None:
            return json.dumps([])
        
        # Ensure both images have the same resolution
        if input_image.shape[:2] != source_image.shape[:2]:
            source_image = cv2.resize(source_image, (input_image.shape[1], input_image.shape[0]))
        
        # Reshape input image and source image to a batch of 1
        input_image_batch = np.expand_dims(input_image, axis=0)
        source_image_batch = np.expand_dims(source_image, axis=0)

        # Detect keypoints and descriptors using XFeat
        matches_list = self.xfeat.match_xfeat_star(input_image_batch, source_image_batch)

        input_matches_list = matches_list[0]
        source_matches_list = matches_list[1]

        # Calculate homography
        homography, mask = cv2.findHomography(source_matches_list, input_matches_list, cv2.RANSAC, 5)

        good_matches = np.sum(mask)
        print(f"Percent good matches: {good_matches / len(mask) * 100:.2f}% - {good_matches} / {len(mask)}")

        # Concatenate the two images side by side
        concatenated_image = cv2.hconcat([input_image, source_image])

        # Draw matches on the concatenated image with a gradient from green to red
        num_matches = len(input_matches_list)
        for i, (input_point, source_point) in enumerate(zip(input_matches_list, source_matches_list)):
            input_x, input_y = int(input_point[0]), int(input_point[1])
            source_x, source_y = int(source_point[0] + input_image.shape[1]), int(source_point[1])  # Offset x-coordinate for the source image
            
            if mask[i] == 0:
                # Calculate gradient color (green to red)
                r = 255
                g = 0
                b = 0  # No blue component
                color = (b, g, r)
            if mask[i] == 1:
                # Calculate gradient color (blue to purple)
                r = 0
                g = 255
                b = 0
                color = (b, g, r)
            
            # Draw circles and lines with the gradient color
            cv2.circle(concatenated_image, (input_x, input_y), 5, color, -1)
            cv2.circle(concatenated_image, (source_x, source_y), 5, color, -1)
            cv2.line(concatenated_image, (input_x, input_y), (source_x, source_y), color, 1)

        # Save the concatenated image with matches
        concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
        cv2.imwrite(concatenated_image_path, concatenated_image)

        # Convert homography matrix to a np array
        homography = np.array(homography).tolist()

        return json.dumps(homography)