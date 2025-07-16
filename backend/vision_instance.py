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

import asyncio

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

        self.step_task: asyncio.Task = None
        
        # Homography stabilization
        self.homography_buffer = []
        self.stable_homography = None
        self.homography_buffer_size = 5
        self.min_match_confidence = 0.15  # Minimum inlier ratio (25% of matches must be inliers)
        self.smoothing_factor = 0.2  # Higher = more smoothing

        self.tracked_element_index = None

    async def set_source_image(self, source_image: np.ndarray, image_path):
        self.tracked_element_index = None

        self.source_image = source_image
        self.source_debug_image = source_image.copy()

        self.text_info = self.__get_text_info(image_path)
        
        # Reset homography stabilization for new source image
        self.homography_buffer = []
        self.stable_homography = None

        await self.speech_service.finalize_start_touching_touchscreen()

        await self.websocket.send_json({
            "type": "source_image_set",
            "data": True
        })

    async def step(self, input_data):
        source_image = input_data.get("image", None)
        if not source_image:
            raise ValueError("Source image is required")
        
        # Decode base64 image
        source_image_bytes = base64.b64decode(source_image)

        input_image_orig = cv2.imdecode(np.frombuffer(source_image_bytes, np.uint8), cv2.IMREAD_COLOR)
        input_image = cv2.cvtColor(input_image_orig, cv2.COLOR_BGR2RGB)

        self.input_image = input_image
        self.input_debug_image = input_image.copy()
        self.source_debug_image = self.source_image.copy()

        hands_info = self.__detect_hands(self.input_image)

        homography = self.__get_homography(self.input_image, self.source_image)

        input_finger_tip_location, source_finger_tip_location = self.__get_finger_tip_location(hands_info, homography, self.input_image)
        
        # Store the latest source finger position and check for text under finger
        text_under_finger = None
        distance_to_tracked_element = None
        if source_finger_tip_location:
            self.latest_source_finger_position = source_finger_tip_location
            text_under_finger = self.get_text_under_finger(source_finger_tip_location)
            if text_under_finger:
                print(f"Text under finger: {text_under_finger['text']}")
            
            # Calculate distance to tracked element if one is being tracked
            if self.tracked_element_index is not None:
                distance_to_tracked_element = self.get_distance_to_tracked_element(source_finger_tip_location)
                if distance_to_tracked_element is not None:
                    print(f"Distance to tracked element: {distance_to_tracked_element:.2f} pixels")

        self.__draw_debug_info(self.input_debug_image, self.source_debug_image, homography, hands_info, input_finger_tip_location, source_finger_tip_location, text_under_finger)

        # Convert np.ndarray to base64-encoded strings
        _, input_image_encoded = cv2.imencode('.jpg', self.input_debug_image)
        _, source_image_encoded = cv2.imencode('.jpg', self.source_debug_image)

        input_image_base64 = base64.b64encode(input_image_encoded).decode('utf-8')
        source_image_base64 = base64.b64encode(source_image_encoded).decode('utf-8')

        return_data = {
            "input_image": input_image_base64,
            "source_image": source_image_base64,
            "text_under_finger": text_under_finger,
            "distance_to_tracked_element": distance_to_tracked_element,
            "tracked_element_index": self.tracked_element_index
        }

        await self.websocket.send_json({
            "type": "step_response",
            "data": return_data
        })

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
        self.source_debug_image = source_image.copy()

        self.__draw_source_on_input(self.input_debug_image, self.source_debug_image, homography)
        self.__draw_hands(self.input_debug_image, self.source_debug_image, hands_info, input_finger_tip_location, source_finger_tip_location)
        self.__draw_text_data(self.input_debug_image, self.source_debug_image, self.text_info, homography, text_under_finger)

        # Warp the input image to match the source image perspective
        homography_inv = np.linalg.inv(homography)
        source_height, source_width = self.source_image.shape[:2]
        warped_input_image = cv2.warpPerspective(input_image, homography_inv, (source_width, source_height))
        
        self.source_debug_image = cv2.addWeighted(self.source_debug_image, 1, warped_input_image, 0.8, 0)
    
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
            current_index = 0
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
                            
                            # Choose color and thickness based on whether this is the tracked element
                            if self.tracked_element_index is not None and current_index == self.tracked_element_index:
                                # Tracked element - use bright magenta/purple and thicker line
                                color = (255, 0, 255)  # Magenta
                                thickness = 4
                                text_color = (255, 0, 255)
                            else:
                                # Regular element - use red
                                color = (0, 0, 255)  # Red
                                thickness = 2
                                text_color = (0, 0, 255)
                            
                            # Draw polygon on source image
                            cv2.polylines(source_debug_image, [points], isClosed=True, color=color, thickness=thickness)
                            
                            # Draw text
                            text = line.text
                            # Get top-left corner of bounding box for text placement
                            text_position = (int(bbox[0]), int(bbox[1]) - 10)
                            cv2.putText(source_debug_image, text, text_position, 
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, text_color, 1)
                            
                            # Transform the bounding box to input image coordinates using homography
                            points_float = points.astype(np.float32).reshape(-1, 1, 2)
                            transformed_points = cv2.perspectiveTransform(points_float, homography)
                            transformed_points = transformed_points.astype(np.int32)
                            
                            # Draw transformed polygon on input image
                            cv2.polylines(input_debug_image, [transformed_points], isClosed=True, color=color, thickness=thickness)
                            
                            # Draw transformed text
                            text = line.text
                            # Get top-left corner of transformed bounding box for text placement
                            transformed_text_position = (transformed_points[0][0][0], transformed_points[0][0][1] - 10)
                            cv2.putText(input_debug_image, text, transformed_text_position, 
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, text_color, 1)
                            
                            current_index += 1
        
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
        # Get the raw homography and its confidence
        raw_homography, confidence = self.__get_homography_xfeat(input_image, source_image)
        
        # Apply temporal stabilization
        return self.__stabilize_homography(raw_homography, confidence)

    def __get_homography_xfeat(self, input_image, source_image):
        """
        Get homography with confidence metric from XFeat matching.
        Returns (homography_matrix, confidence_score)
        """
        # Use the matching service's new method that returns both homography and inlier ratio
        homography, confidence = self.matching_service.get_homography_xfeat(input_image, source_image)
        
        return homography, confidence
    
    def __stabilize_homography(self, new_homography, confidence):
        """
        Apply temporal smoothing to reduce homography jitter.
        """
        if new_homography is None:
            return self.stable_homography if self.stable_homography is not None else np.eye(3)
        
        # If confidence is too low, don't update
        if confidence < self.min_match_confidence:
            if self.stable_homography is not None:
                return self.stable_homography
            else:
                # First frame or no stable homography yet
                self.stable_homography = new_homography.copy()
                return new_homography
        
        # Add to buffer
        self.homography_buffer.append({
            'matrix': new_homography.copy(),
            'confidence': confidence
        })
        
        # Keep buffer size manageable
        if len(self.homography_buffer) > self.homography_buffer_size:
            self.homography_buffer.pop(0)
        
        # Calculate weighted average of recent homographies
        if self.stable_homography is None:
            # First good homography
            self.stable_homography = new_homography.copy()
            return new_homography
        
        # Exponential moving average with confidence weighting
        smoothed_homography = self.__calculate_smoothed_homography()
        
        self.stable_homography = smoothed_homography
        return smoothed_homography
    
    def __calculate_smoothed_homography(self):
        """
        Calculate a confidence-weighted smoothed homography from the buffer.
        """
        if not self.homography_buffer:
            return self.stable_homography
        
        # Get the most recent homography
        latest = self.homography_buffer[-1]
        
        # Simple exponential moving average
        alpha = 1.0 - self.smoothing_factor  # Lower alpha = more smoothing
        
        # Weight alpha by confidence
        weighted_alpha = alpha * latest['confidence']
        
        # Smooth the homography matrix element-wise
        smoothed = (1.0 - weighted_alpha) * self.stable_homography + weighted_alpha * latest['matrix']
        
        return smoothed
    
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

    def get_distance_to_tracked_element(self, finger_position):
        """
        Calculate the distance from fingertip to the tracked element.
        
        Args:
            finger_position (dict): Contains 'x' and 'y' coordinates of the fingertip in the source image space.
        
        Returns:
            float: Distance in pixels from fingertip to tracked element, or None if no tracked element or finger.
        """
        if not self.text_info or not finger_position or self.tracked_element_index is None or len(self.text_info) == 0:
            return None
            
        x, y = finger_position['x'], finger_position['y']
        
        # Get image dimensions
        original_width = self.text_info[0].width
        original_height = self.text_info[0].height
        
        # Current image dimensions
        source_height, source_width = self.source_image.shape[:2]
        
        # Find the tracked element by index
        line = self.text_info[0].lines[self.tracked_element_index]
        # This is our tracked element
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

        # For more accurate distance, calculate distance to closest edge
        # Use pointPolygonTest with measureDist=True to get signed distance
        signed_distance = cv2.pointPolygonTest(points, (x, y), True)
        
        # If positive, point is inside (should be 0, but just in case)
        # If negative, it's the distance to the closest edge
        return abs(signed_distance)
    
    def get_current_image_description(self):
        # Check if source image is set
        if self.source_image is None:
            raise ValueError("Source image is not set. Please set a source image before requesting a description.")
        
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
                            "url": np_array_image_to_data_url(self.source_image)
                        }
                    }
                ] } 
            ],
            max_tokens=2000 
        )
        
        ai_description = response.choices[0].message.content.strip()
        
        # Format text_info into a list with IDs
        text_elements = []
        if self.text_info:
            text_id = 0
            # Get image dimensions for position calculations
            if len(self.text_info) > 0:
                original_width = self.text_info[0].width
                original_height = self.text_info[0].height
                
                # First pass: calculate the overall bounding area of all text
                all_text_bounds = self._calculate_overall_text_bounds()
                
                for read_result in self.text_info:
                    for line in read_result.lines:
                        # Calculate position based on bounding box center
                        bbox = line.bounding_box
                        # Get center of bounding box (average of all corner points)
                        center_x = (bbox[0] + bbox[2] + bbox[4] + bbox[6]) / 4
                        center_y = (bbox[1] + bbox[3] + bbox[5] + bbox[7]) / 4
                        
                        # Normalize to the overall text bounding area (0-1 range within text area)
                        if all_text_bounds:
                            norm_x = (center_x - all_text_bounds['min_x']) / (all_text_bounds['max_x'] - all_text_bounds['min_x'])
                            norm_y = (center_y - all_text_bounds['min_y']) / (all_text_bounds['max_y'] - all_text_bounds['min_y'])
                        else:
                            # Fallback to absolute positioning if bounds calculation fails
                            norm_x = center_x / original_width
                            norm_y = center_y / original_height
                        
                        text_elements.append({
                            'id': text_id,
                            'text': line.text,
                            'position_in_bounded_text_area': {
                                'norm_x': norm_x,
                                'norm_y': norm_y
                            }
                        })
                        text_id += 1
        
        return {
            'description': ai_description,
            'text_elements': text_elements
        }
    
    def _calculate_overall_text_bounds(self):
        """
        Calculate the overall bounding area that contains all detected text.
        
        Returns:
            dict: Contains min_x, max_x, min_y, max_y of the overall text area, or None if no text
        """
        if not self.text_info:
            return None
            
        min_x = float('inf')
        max_x = float('-inf')
        min_y = float('inf')
        max_y = float('-inf')
        
        for read_result in self.text_info:
            for line in read_result.lines:
                bbox = line.bounding_box
                # Get all corner points of the bounding box
                x_coords = [bbox[0], bbox[2], bbox[4], bbox[6]]
                y_coords = [bbox[1], bbox[3], bbox[5], bbox[7]]
                
                # Update overall bounds
                min_x = min(min_x, min(x_coords))
                max_x = max(max_x, max(x_coords))
                min_y = min(min_y, min(y_coords))
                max_y = max(max_y, max(y_coords))
        
        # Return None if no valid bounds found
        if min_x == float('inf'):
            return None
            
        return {
            'min_x': min_x,
            'max_x': max_x,
            'min_y': min_y,
            'max_y': max_y
        }
        
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

    async def track_element(self, element_index):
        """
        Tracks a specific element by its index.
        
        Args:
            element_index (int): The index of the element to track.
        """
        if not self.text_info or len(self.text_info) == 0 or len(self.text_info[0].lines) < element_index:
            raise ValueError("No text information available to track elements.")
        
        self.tracked_element_index = element_index
        
        print(f"Now tracking element {element_index}: '{self.text_info[0].lines[element_index].text}'")

    async def clear_tracked_element(self):
        """
        Clears the currently tracked element.
        """
        if self.tracked_element_index is not None:
            print(f"Clearing tracking of element {self.tracked_element_index}")
            self.tracked_element_index = None
        else:
            print("No element is currently being tracked.")