import cv2
import numpy as np
import torch
import tqdm
import json
import os

from modules.xfeat import XFeat
import matplotlib.pyplot as plt

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

HAND_CONNECTIONS = mp.solutions.hands.HAND_CONNECTIONS

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

class VisionInstance:

    def __init__(self, hands_detector):
        self.source_image = None
        self.input_image = None

        self.input_debug_image = None
        self.source_debug_image = None

        self.hands_detector = hands_detector

        self.xfeat = torch.hub.load('verlab/accelerated_features', 'XFeat', pretrained = True, top_k = 4096)

        data_path = os.path.join(os.path.dirname(__file__), 'test_data_screen.json')
        with open(data_path, 'r') as file:
            self.test_data = json.load(file)

    def set_source_image(self, source_image: np.ndarray):
        self.source_image = source_image
        self.source_debug_image = source_image.copy()

        self.text_info = self.__get_text_info(source_image)

        return True

    def step(self, input_image: np.ndarray):
        import time
        start_time = time.time()
        timing_data = {}

        self.input_image = input_image
        self.input_debug_image = input_image.copy()
        self.source_debug_image = self.source_image.copy()

        # Time hands detection
        hands_start = time.time()
        hands_info = self.__detect_hands(self.input_image)
        hands_end = time.time()
        timing_data['hands_detection'] = hands_end - hands_start

        # Time homography calculation
        homography_start = time.time()
        homography = self.__get_homography(self.input_image, self.source_image)
        homography_end = time.time()
        timing_data['homography'] = homography_end - homography_start

        # Time finger tip location calculation
        fingertip_start = time.time()
        input_finger_tip_location, source_finger_tip_location = self.__get_finger_tip_location(hands_info, homography, self.input_image)
        fingertip_end = time.time()
        timing_data['finger_tip_location'] = fingertip_end - fingertip_start

        # Time debug info drawing
        debug_start = time.time()
        self.__draw_debug_info(self.input_debug_image, self.source_debug_image, homography, hands_info, input_finger_tip_location, source_finger_tip_location)
        debug_end = time.time()
        timing_data['draw_debug_info'] = debug_end - debug_start

        # Calculate total time
        end_time = time.time()
        total_time = end_time - start_time

        # Print timing table
        self.__print_timing_table(timing_data, total_time)

        return self.input_debug_image, self.source_debug_image

    def __print_timing_table(self, timing_data, total_time):
        """Prints a formatted table of timing data"""
        print("\n--- Performance Timing ---")
        print(f"{'Function':<25} {'Time (ms)':<15} {'Percentage':<10}")
        print("-" * 50)
        
        for func_name, time_taken in timing_data.items():
            ms_time = time_taken * 1000  # Convert to milliseconds
            percentage = (time_taken / total_time) * 100
            print(f"{func_name:<25} {ms_time:<15.2f} {percentage:<10.2f}%")
        
        print("-" * 50)
        print(f"{'Total':<25} {(total_time * 1000):<15.2f} {'100.00':<10}%")
        print("-------------------------\n")

    def __detect_hands(self, input_image):

        image = mp.Image.image = mp.Image(image_format=mp.ImageFormat.SRGB, data=input_image)

        return self.hands_detector.detect(image)
    
    def __get_finger_tip_location(self, hands_info, homography, input_image):
        if hands_info.hand_landmarks:
            src = input_image

            # Extract fingertip coordinates (index finger tip - landmark 8)
            landmarks = hands_info.hand_landmarks[0]
            x = landmarks[8].x * src.shape[1]  # src.cols equivalent
            y = landmarks[8].y * src.shape[0]  # src.rows equivalent

            # Invert the homography matrix
            homography_inv = cv2.invert(homography)[1]

            # Transform the fingertip point using the inverted homography
            src_point = np.array([[x, y]], dtype=np.float32).reshape(-1, 1, 2)
            dst_point = cv2.perspectiveTransform(src_point, homography_inv)

            dst_x, dst_y = dst_point[0][0]

            return {'x': x, 'y': y}, {'x': dst_x, 'y': dst_y}
        else:
            return None, None
    
    def __draw_debug_info(self, input_image, source_image, homography, hands_info, input_finger_tip_location, source_finger_tip_location):
        # Placeholder for drawing debug information

        self.__draw_source_on_input(self.input_debug_image, self.source_debug_image, homography)
        self.__draw_hands(self.input_debug_image, self.source_debug_image, hands_info, input_finger_tip_location, source_finger_tip_location)
    
    def __draw_source_on_input(self, input_debug_mat, source_debug_mat, homography):
        # Get the dimensions of the source debug matrix
        height, width = source_debug_mat.shape[:2]

        # Define the corner points of the source image
        corner_pts = np.array([[0, 0], [width, 0], [width, height], [0, height]], dtype=np.float32).reshape(-1, 1, 2)

        # Transform the corner points using the homography matrix
        aligned_corners = cv2.perspectiveTransform(corner_pts, homography)

        # Convert aligned corners to integer points
        aligned_corners_int = np.int32(aligned_corners)

        # Draw the polygon on the input debug matrix
        cv2.polylines(input_debug_mat, [aligned_corners_int], isClosed=True, color=(0, 255, 0, 255), thickness=2)

    def __draw_hands(self, input_debug_mat, source_debug_mat, hand_landmarker_result, input_finger_tip_location, source_finger_tip_location):
        if hand_landmarker_result.hand_landmarks:
            src = input_debug_mat

            for landmarks in hand_landmarker_result.hand_landmarks:
                for i, landmark in enumerate(landmarks):
                    x = int(landmark.x * src.shape[1])  # src.cols equivalent
                    y = int(landmark.y * src.shape[0])  # src.rows equivalent
                    color = (255, 0, 0, 255) if i == 8 else (0, 0, 255, 255)  # Red for index finger tip, blue for others
                    cv2.circle(src, (x, y), 5, color, -1)

                for start_idx, end_idx in HAND_CONNECTIONS:
                    start_x = int(landmarks[start_idx].x * src.shape[1])
                    start_y = int(landmarks[start_idx].y * src.shape[0])
                    end_x = int(landmarks[end_idx].x * src.shape[1])
                    end_y = int(landmarks[end_idx].y * src.shape[0])
                    cv2.line(src, (start_x, start_y), (end_x, end_y), (0, 255, 0, 255), 2)

            if source_finger_tip_location:
                cv2.circle(source_debug_mat, 
                        (int(source_finger_tip_location['x']), int(source_finger_tip_location['y'])), 
                        5, (255, 0, 0, 255), -1)
                
    def __draw_text_data(self, input_debug_image, source_debug_image, image_text_data, homography):
        # TODO
        return None
    
    def __get_homography(self, input_image, source_image):
        # Resize images to half size for faster processing
        resize_factor = 0.5
        input_image_resized = cv2.resize(input_image, None, fx=resize_factor, fy=resize_factor)
        source_image_resized = cv2.resize(source_image, None, fx=resize_factor, fy=resize_factor)
        
        # Detect and compute on resized images
        output0 = self.xfeat.detectAndCompute(source_image_resized, top_k = 4096)[0]
        output1 = self.xfeat.detectAndCompute(input_image_resized, top_k = 4096)[0]

        # Set the image size to the original dimensions
        output0.update({'image_size': (source_image.shape[1], source_image.shape[0])})
        output1.update({'image_size': (input_image.shape[1], input_image.shape[0])})
        
        # Match features
        mkpts_0, mkpts_1, other = self.xfeat.match_lighterglue(output0, output1)
        
        # Scale keypoints back to original image size
        mkpts_0 = mkpts_0 / resize_factor
        mkpts_1 = mkpts_1 / resize_factor

        # Calculate homography and create visualization
        canvas, homography = warp_corners_and_draw_matches(mkpts_0, mkpts_1, source_image, input_image)

        # Save the concatenated image with matches
        concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
        cv2.imwrite(concatenated_image_path, canvas)

        return homography
    
    def __get_text_info(self, input_image):
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