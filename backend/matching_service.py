import torch
import cv2
import os
import numpy as np

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

class MatchingService:
    def __init__(self):
        self.xfeat = torch.hub.load('verlab/accelerated_features', 'XFeat', pretrained = True, top_k = 4096)

    def get_homography_xfeat(self, input_image, source_image):
        """
        Get homography with confidence metric based on inlier ratio.
        Returns (homography_matrix, confidence_score)
        """
        # Check if XFeat model is available
        if self.xfeat is None:
            print("Error: XFeat model not loaded")
            return None, 0.0
            
        # Validate input images
        if input_image is None or source_image is None:
            print("Error: One or both input images are None")
            return None, 0.0
            
        if input_image.size == 0 or source_image.size == 0:
            print("Error: One or both input images are empty")
            return None, 0.0
            
        # Check image dimensions
        if len(input_image.shape) != 3 or len(source_image.shape) != 3:
            print(f"Error: Images must be 3-channel. Input shape: {input_image.shape}, Source shape: {source_image.shape}")
            return None, 0.0
        
        # Only resize if either dimension is larger than max_dimension pixels
        max_dimension = 600
        
        # Check input image dimensions
        input_h, input_w = input_image.shape[:2]
        input_max_dim = max(input_h, input_w)
        input_resize_factor = min(1.0, max_dimension / input_max_dim) if input_max_dim > max_dimension else 1.0
        
        # Check source image dimensions  
        source_h, source_w = source_image.shape[:2]
        source_max_dim = max(source_h, source_w)
        source_resize_factor = min(1.0, max_dimension / source_max_dim) if source_max_dim > max_dimension else 1.0
        
        # Resize images only if needed
        try:
            if input_resize_factor < 1.0:
                input_image_resized = cv2.resize(input_image, None, fx=input_resize_factor, fy=input_resize_factor)
            else:
                input_image_resized = input_image
                
            if source_resize_factor < 1.0:
                source_image_resized = cv2.resize(source_image, None, fx=source_resize_factor, fy=source_resize_factor)
            else:
                source_image_resized = source_image
        except Exception as e:
            print(f"Error resizing images: {e}")
            return None, 0.0

        # Validate images before processing
        if source_image_resized.size == 0 or input_image_resized.size == 0:
            print("Error: One or both images are empty after resizing")
            return None, 0.0
            
        # Check minimum image dimensions
        min_dim = 32  # Minimum dimension for feature detection
        if (source_image_resized.shape[0] < min_dim or source_image_resized.shape[1] < min_dim or
            input_image_resized.shape[0] < min_dim or input_image_resized.shape[1] < min_dim):
            print(f"Error: Images too small after resizing. Source: {source_image_resized.shape}, Input: {input_image_resized.shape}")
            return None, 0.0

        # Detect and compute on resized images with fewer features
        top_k = 2048  # Reduce from 4096 to 2048 features
        try:
            output0 = self.xfeat.detectAndCompute(source_image_resized, top_k=top_k)[0]
            output1 = self.xfeat.detectAndCompute(input_image_resized, top_k=top_k)[0]
        except Exception as e:
            print(f"Error in feature detection: {e}")
            return None, 0.0

        # Validate feature outputs
        if (not output0 or not output1 or 
            'keypoints' not in output0 or 'keypoints' not in output1 or
            'descriptors' not in output0 or 'descriptors' not in output1):
            print("Error: Feature detection failed - no valid features found")
            return None, 0.0
            
        # Check if we have enough keypoints
        if (output0['keypoints'].shape[0] < 4 or output1['keypoints'].shape[0] < 4):
            print(f"Error: Insufficient keypoints. Source: {output0['keypoints'].shape[0]}, Input: {output1['keypoints'].shape[0]}")
            return None, 0.0

        # Set the image size to the original dimensions
        output0.update({'image_size': (source_image.shape[1], source_image.shape[0])})
        output1.update({'image_size': (input_image.shape[1], input_image.shape[0])})
        
        # Match features with error handling
        try:
            mkpts_0, mkpts_1, other = self.xfeat.match_lighterglue(output0, output1)
        except Exception as e:
            print(f"Error in feature matching: {e}")
            return None, 0.0
        
        if len(mkpts_0) < 4:  # Need at least 4 points for homography
            return None, 0.0
        
        # Scale keypoints back to original image size
        mkpts_0 = mkpts_0 / source_resize_factor
        mkpts_1 = mkpts_1 / input_resize_factor

        # Calculate homography using USAC_FAST algorithm with fewer iterations
        H, mask = cv2.findHomography(mkpts_0, mkpts_1, cv2.USAC_FAST, 3.0, maxIters=500, confidence=0.995)
        
        if H is None or mask is None:
            return None, 0.0
        
        # Calculate inlier ratio as confidence
        mask = mask.flatten()
        inlier_ratio = np.sum(mask) / len(mask)
        
        print(f'Inlier ratio (confidence): {inlier_ratio:.3f}')
        
        # Only generate visualization in debug mode or when needed
        if os.environ.get('DEBUG_VISUALIZATION', '0') == '1':
            # Calculate homography and create visualization
            canvas, _ = warp_corners_and_draw_matches(mkpts_0, mkpts_1, source_image, input_image)
            # Save the concatenated image with matches
            concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
            cv2.imwrite(concatenated_image_path, canvas)

        return H, inlier_ratio