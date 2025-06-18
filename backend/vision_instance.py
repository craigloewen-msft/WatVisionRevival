import cv2
import numpy as np
import json
import os

import mediapipe as mp

from azure.cognitiveservices.vision.computervision import ComputerVisionClient

from types import SimpleNamespace

from openai import AzureOpenAI

import base64
from mimetypes import guess_type

from speech_service import ContinuousSpeechService

from matching_service import MatchingService

from fastapi import WebSocket


HAND_CONNECTIONS = mp.solutions.hands.HAND_CONNECTIONS

# Function to encode a local image into data URL 
def local_image_to_data_url(image_path):
    # Guess the MIME type of the image based on the file extension
    mime_type, _ = guess_type(image_path)
    if mime_type is None:
        mime_type = 'application/octet-stream'  # Default MIME type if none is found

    # Read and encode the image file
    with open(image_path, "rb") as image_file:
        base64_encoded_data = base64.b64encode(image_file.read()).decode('utf-8')

    # Construct the data URL
    return f"data:{mime_type};base64,{base64_encoded_data}"

def np_array_image_to_data_url(np_array_image):
    """
    Convert a NumPy array image to a data URL.
    
    Args:
        np_array_image (np.ndarray): The image in NumPy array format.
        
    Returns:
        str: The data URL of the image.
    """
    # Convert the NumPy array to bytes
    _, buffer = cv2.imencode('.png', np_array_image)
    base64_encoded_data = base64.b64encode(buffer).decode('utf-8')
    
    # Construct the data URL
    return f"data:image/png;base64,{base64_encoded_data}"

class VisionInstance:

    def __init__(
        self, 
        hands_detector, 
        computer_vision_client: ComputerVisionClient, 
        llm_client: AzureOpenAI, 
        matching_service: MatchingService,
        session_id: str,
        websocket: WebSocket 
    ):
        self.source_image = None
        self.input_image = None

        self.input_debug_image = None
        self.source_debug_image = None

        self.text_info = None

        self.llm_client = llm_client
        self.deployment_name = os.getenv('AZURE_LLM_DEPLOYMENT')

        self.hands_detector = hands_detector

        self.computer_vision_client = computer_vision_client

        self.speech_service = ContinuousSpeechService(websocket, session_id, self)

        self.websocket = websocket

        self.matching_service = matching_service

        self.session_id = session_id

        data_path = os.path.join(os.path.dirname(__file__), 'test_data_video.json')
        with open(data_path, 'r') as file:
            self.test_data = json.load(file, object_hook=lambda d: SimpleNamespace(**d))

    async def set_source_image(self, source_image: np.ndarray, image_path):
        self.source_image = source_image
        self.source_debug_image = source_image.copy()

        self.text_info = self.__get_text_info(image_path)

        await self.speech_service.finalize_start_touching_touchscreen()

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
        
        # Store the latest source finger position and check for text under finger
        text_under_finger = None
        if source_finger_tip_location:
            self.latest_source_finger_position = source_finger_tip_location
            text_under_finger = self.get_text_under_finger(source_finger_tip_location)
            if text_under_finger:
                print(f"Text under finger: {text_under_finger['text']}")

        # Time debug info drawing
        debug_start = time.time()
        self.__draw_debug_info(self.input_debug_image, self.source_debug_image, homography, hands_info, input_finger_tip_location, source_finger_tip_location, text_under_finger)
        debug_end = time.time()
        timing_data['draw_debug_info'] = debug_end - debug_start

        # Calculate total time
        end_time = time.time()
        total_time = end_time - start_time

        # Print timing table
        self.__print_timing_table(timing_data, total_time)

        return self.input_debug_image, self.source_debug_image, text_under_finger

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
    
    def __draw_debug_info(self, input_image, source_image, homography, hands_info, input_finger_tip_location, source_finger_tip_location, text_under_finger):
        self.__draw_source_on_input(self.input_debug_image, self.source_debug_image, homography)
        self.__draw_hands(self.input_debug_image, self.source_debug_image, hands_info, input_finger_tip_location, source_finger_tip_location)
        self.__draw_text_data(self.input_debug_image, self.source_debug_image, self.text_info, homography, text_under_finger)
    
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
                
    def __draw_text_data(self, input_debug_image, source_debug_image, image_text_data, homography, text_under_finger):
        if not image_text_data:
            return None

        # Get current image dimensions
        source_height, source_width = source_debug_image.shape[:2]
        input_height, input_width = input_debug_image.shape[:2]

        # Get the original analyzed image dimensions from the text_data
        if len(image_text_data) > 0:
            original_width = image_text_data[0].width
            original_height = image_text_data[0].height
            
            # Draw text boxes and text on source image
            for read_result in image_text_data:
                    for line in read_result.lines:
                            # Extract bounding box points
                            bbox = line.bounding_box
                            # Convert bounding box format from [x1,y1,x2,y2,x3,y3,x4,y4] to points
                            original_points = np.array([
                                [bbox[0] / original_width, bbox[1] / original_height],
                                [bbox[2] / original_width, bbox[3] / original_height],
                                [bbox[4] / original_width, bbox[5] / original_height],
                                [bbox[6] / original_width, bbox[7] / original_height]
                            ], dtype=np.float32)

                            # Scale points to source image dimensions
                            points = (original_points * np.array([source_width, source_height])).astype(np.int32).reshape(-1, 1, 2)
                            
                            # Draw polygon on source image
                            cv2.polylines(source_debug_image, [points], isClosed=True, color=(0, 0, 255), thickness=2)
                            
                            # Draw text
                            text = line.text
                            # Get top-left corner of bounding box for text placement
                            text_position = (int(bbox[0]), int(bbox[1]) - 10)
                            cv2.putText(source_debug_image, text, text_position, 
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
                            
                            # Transform the bounding box to input image coordinates using homography
                            points_float = points.astype(np.float32).reshape(-1, 1, 2)
                            transformed_points = cv2.perspectiveTransform(points_float, homography)
                            transformed_points = transformed_points.astype(np.int32)
                            
                            # Draw transformed polygon on input image
                            cv2.polylines(input_debug_image, [transformed_points], isClosed=True, color=(0, 0, 255), thickness=2)
                            
                            # Draw transformed text
                            text = line.text
                            # Get top-left corner of transformed bounding box for text placement
                            transformed_text_position = (transformed_points[0][0][0], transformed_points[0][0][1] - 10)
                            cv2.putText(input_debug_image, text, transformed_text_position, 
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
        
        # Draw text under finger if available
        if text_under_finger:
            bbox = text_under_finger['boundingBox']
            # Draw bounding box on source image
            cv2.polylines(source_debug_image, [np.array(bbox)], isClosed=True, color=(0, 255, 0), thickness=2)
            
            # Draw text on source image
            text_position = (bbox[0][0], bbox[0][1] - 10)
            cv2.putText(source_debug_image, text_under_finger['text'], text_position, 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            
            # Transform the bounding box to input image coordinates using homography
            bbox_float = np.array(bbox).astype(np.float32).reshape(-1, 1, 2)
            transformed_bbox = cv2.perspectiveTransform(bbox_float, homography)
            transformed_bbox = transformed_bbox.astype(np.int32)
            
            # Draw transformed bounding box on input image
            cv2.polylines(input_debug_image, [transformed_bbox], isClosed=True, color=(0, 255, 0), thickness=2)
            
            # Draw transformed text
            transformed_text_position = (transformed_bbox[0][0][0], transformed_bbox[0][0][1] - 10)
            cv2.putText(input_debug_image, text_under_finger['text'], transformed_text_position, 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

        return input_debug_image, source_debug_image
    
    def __get_homography(self, input_image, source_image):
        # Default to use xfeat for homography
        return self.__get_homography_xfeat(input_image, source_image)
    
    def __get_homography_orb(self, input_image, source_image):
        # Create ORB detector
        orb = cv2.ORB_create(nfeatures=2000)
        
        # Detect keypoints and compute descriptors
        kp1, des1 = orb.detectAndCompute(source_image, None)
        kp2, des2 = orb.detectAndCompute(input_image, None)
        
        # Create matcher
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        
        # Match descriptors
        matches = bf.match(des1, des2)
        
        # Sort matches by distance
        matches = sorted(matches, key=lambda x: x.distance)
        
        # Use top matches (adjust as needed)
        good_matches = matches[:100]
        
        # Extract location of good matches
        src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
        
        # Calculate Homography
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        
        # Draw matches for debug visualization
        match_img = cv2.drawMatches(source_image, kp1, input_image, kp2, good_matches, None, 
                                    flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
        
        # Save the concatenated image with matches
        concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
        cv2.imwrite(concatenated_image_path, match_img)
        
        return H
    
    def __get_homography_sift(self, input_image, source_image):
        # Create SIFT detector
        sift = cv2.SIFT_create()
        
        # Detect keypoints and compute descriptors
        kp1, des1 = sift.detectAndCompute(source_image, None)
        kp2, des2 = sift.detectAndCompute(input_image, None)
        
        # FLANN parameters
        FLANN_INDEX_KDTREE = 1
        index_params = dict(algorithm=FLANN_INDEX_KDTREE, trees=5)
        search_params = dict(checks=50)
        
        # Create FLANN matcher
        flann = cv2.FlannBasedMatcher(index_params, search_params)
        
        # Match descriptors
        matches = flann.knnMatch(des1, des2, k=2)
        
        # Apply ratio test
        good_matches = []
        for m, n in matches:
            if m.distance < 0.7 * n.distance:
                good_matches.append(m)
        
        # Extract location of good matches
        if len(good_matches) > 10:
            src_pts = np.float32([kp1[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([kp2[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            
            # Calculate Homography
            H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
            
            # Draw matches for debug visualization
            match_mask = mask.ravel().tolist()
            draw_params = dict(matchColor=(0, 255, 0),
                               singlePointColor=None,
                               matchesMask=match_mask,
                               flags=2)
            
            match_img = cv2.drawMatches(source_image, kp1, input_image, kp2, good_matches, None, **draw_params)
            
            # Save the concatenated image with matches
            concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
            cv2.imwrite(concatenated_image_path, match_img)
            
            return H
        else:
            print("Not enough good matches found for SIFT homography")
            return None
    
    def __get_homography_xfeat(self, input_image, source_image):
        # Resize images to smaller size for faster processing
        return self.matching_service.get_homography_xfeat(input_image, source_image)
    
    def __get_text_info(self, input_image_path):
        # try: 
        #     with open(input_image_path, 'rb') as image_stream:
        #         result = self.computer_vision_client.read_in_stream(image_stream, language='en', raw=True)
                
        #         operation_location = result.headers["Operation-Location"]
        #         operation_id = operation_location.split("/")[-1]

        
        #     while True:
        #         read_result = self.computer_vision_client.get_read_result(operation_id)
                
        #         if read_result.status not in ['notStarted', 'running']:
        #             break
        #         time.sleep(1)
        
        #     return read_result.analyze_result.read_results
        # except Exception as error:
        #     print(f"Error analyzing image: {error}")
        #     return None

        return self.test_data.readResults
        
    def get_text_under_finger(self, finger_position=None):
        """
        Identifies which text element the finger is hovering over.
        
        Args:
            finger_position (dict): Contains 'x' and 'y' coordinates of the fingertip in the source image space.
                                    If None, uses the most recently detected finger position.
        
        Returns:
            dict: Contains the text content and bounding box information, or None if no text is under the finger.
        """
        if not self.text_info or not finger_position:
            return None
            
        # Use the most recent finger position if none provided
        if finger_position is None and hasattr(self, 'latest_source_finger_position'):
            finger_position = self.latest_source_finger_position
            
        if not finger_position:
            return None
            
        x, y = finger_position['x'], finger_position['y']
        
        # Get image dimensions
        if len(self.text_info) > 0:
            original_width = self.text_info[0].width
            original_height = self.text_info[0].height
            
            # Current image dimensions
            source_height, source_width = self.source_image.shape[:2]
            
            # Check each text element to see if finger is inside its bounding box
            for read_result in self.text_info:
                for line in read_result.lines:
                    # Extract bounding box points
                    bbox = line.bounding_box
                    
                    # Convert bounding box format from [x1,y1,x2,y2,x3,y3,x4,y4] to points
                    original_points = np.array([
                        [bbox[0] / original_width, bbox[1] / original_height],
                        [bbox[2] / original_width, bbox[3] / original_height],
                        [bbox[4] / original_width, bbox[5] / original_height],
                        [bbox[6] / original_width, bbox[7] / original_height]
                    ], dtype=np.float32)
                    
                    # Scale points to current image dimensions
                    points = (original_points * np.array([source_width, source_height])).astype(np.int32)
                    
                    # Check if point is inside polygon
                    if cv2.pointPolygonTest(points, (x, y), False) >= 0:
                        # Point is inside the polygon
                        return {
                            'text': line.text,
                            'confidence': getattr(line, 'confidence', 0.0),
                            'boundingBox': points.tolist()
                        }
        
        # No text found under finger
        return None
    
    def get_current_image_description(self):
        response = self.llm_client.chat.completions.create(
            model=self.deployment_name,
            messages=[
                { "role": "system", "content": """You are a helpful AI assistant which helps explain an image to a blind or visually impaired person.
You will keep your answers short and sweet. You will be shown an image of a touch screen and describe that touch screen. Focus on describing what it says and the locations of where things are on the touch screen.""" },
                { "role": "user", "content": [  
                    { 
                        "type": "text", 
                        "text": "Describe this picture:" 
                    },
                    { 
                        "type": "image_url",
                        "image_url": {
                            "url": np_array_image_to_data_url(self.input_image)
                        }
                    }
                ] } 
            ],
            max_tokens=2000 
        )
        
        return response.choices[0].message.content.strip()
    
    async def start_session(self):
        """
        Starts the speech recognition service.
        """
        self.speech_service = ContinuousSpeechService(self.websocket, self.session_id, self)
        return await self.speech_service.start_session()

    async def stop_session(self):
        """
        Stops the speech recognition service.
        """
        return await self.speech_service.stop_session()

    async def process_audio_chunk(self, audio_chunk):
        """
        Processes an audio chunk for speech recognition.
        """
        return await self.speech_service.process_audio_chunk(audio_chunk)