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
import matplotlib.pyplot as plt

from vision_instance import VisionInstance

def warp_corners_and_draw_matches(ref_points, dst_points, img1, img2):
    # Calculate the Homography matrix
    H, mask = cv2.findHomography(ref_points, dst_points, cv2.USAC_MAGSAC, 3.5, maxIters=1_000, confidence=0.999)
    mask = mask.flatten()

    print('inlier ratio: ', np.sum(mask)/len(mask))

    # Get corners of the first image (image1)
    h, w = img1.shape[:2]
    corners_img1 = np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], dtype=np.float32).reshape(-1, 1, 2)

    # Warp corners to the second image (image2) space
    warped_corners = cv2.perspectiveTransform(corners_img1, H)

    # Draw the warped corners in image2
    img2_with_corners = img2.copy()
    for i in range(len(warped_corners)):
        start_point = tuple(warped_corners[i-1][0].astype(int))
        end_point = tuple(warped_corners[i][0].astype(int))
        cv2.line(img2_with_corners, start_point, end_point, (255, 0, 0), 4)  # Using solid green for corners

    # Prepare keypoints and matches for drawMatches function
    keypoints1 = [cv2.KeyPoint(p[0], p[1], 5) for p in ref_points]
    keypoints2 = [cv2.KeyPoint(p[0], p[1], 5) for p in dst_points]
    matches = [cv2.DMatch(i,i,0) for i in range(len(mask)) if mask[i]]

    # Draw inlier matches
    img_matches = cv2.drawMatches(img1, keypoints1, img2_with_corners, keypoints2, matches, None,
                                  matchColor=(0, 255, 0), flags=2)

    return (img_matches, H)

class VisionManager:
    def __init__(self, app):
        self.azure_vision_key = os.getenv('AZURE_VISION_KEY')
        self.azure_vision_endpoint = os.getenv('AZURE_VISION_ENDPOINT')

        if not self.azure_vision_key or not self.azure_vision_endpoint:
            raise ValueError('AZURE_VISION_KEY and AZURE_VISION_ENDPOINT must be set in the environment variables')

        self.computer_vision_client = ComputerVisionClient(
            self.azure_vision_endpoint, CognitiveServicesCredentials(self.azure_vision_key)
        )

        data_path = os.path.join(os.path.dirname(__file__), 'test_data_screen.json')
        with open(data_path, 'r') as file:
            self.test_data = json.load(file)

        self.xfeat = torch.hub.load('verlab/accelerated_features', 'XFeat', pretrained = True, top_k = 4096)

        self.visionInstanceList = [ VisionInstance() ]

    def __get_cv_image_from_input(self, input_image):
        input_path = os.path.join(os.getcwd(), 'source_image.jpg')
        input_image.save(input_path)

        input_image = cv2.imread(input_path)
        if input_image is None:
            raise ValueError("Source image could not be loaded")
        
        return input_image

    def set_source_image(self, source_image):
        # Save the source image to a temporary location

        # Set the source image in the VisionInstance
        self.visionInstanceList[0].set_source_image(source_image)
    
    def step(self, input_image):

        input_image = self.__get_cv_image_from_input(input_image)

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

        output0 = self.xfeat.detectAndCompute(source_image, top_k = 4096)[0]
        output1 = self.xfeat.detectAndCompute(input_image, top_k = 4096)[0]

        output0.update({'image_size': (source_image.shape[1], source_image.shape[0])})
        output1.update({'image_size': (input_image.shape[1], input_image.shape[0])})
        
        mkpts_0, mkpts_1, other = self.xfeat.match_lighterglue(output0, output1)

        canvas, homography = warp_corners_and_draw_matches(mkpts_0, mkpts_1, source_image, input_image)

        # Save the concatenated image with matches
        concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
        cv2.imwrite(concatenated_image_path, canvas)

        # Convert homography matrix to a np array
        homography = np.array(homography).tolist()

        return json.dumps(homography)