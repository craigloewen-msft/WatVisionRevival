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
        # Resize images to smaller size for faster processing
        resize_factor = 0.4  # Reduce to 40% of original size
        input_image_resized = cv2.resize(input_image, None, fx=resize_factor, fy=resize_factor)
        source_image_resized = cv2.resize(source_image, None, fx=resize_factor, fy=resize_factor)
        
        # Detect and compute on resized images with fewer features
        top_k = 2048  # Reduce from 4096 to 2048 features
        output0 = self.xfeat.detectAndCompute(source_image_resized, top_k=top_k)[0]
        output1 = self.xfeat.detectAndCompute(input_image_resized, top_k=top_k)[0]

        # Set the image size to the original dimensions
        output0.update({'image_size': (source_image.shape[1], source_image.shape[0])})
        output1.update({'image_size': (input_image.shape[1], input_image.shape[0])})
        
        # Match features
        mkpts_0, mkpts_1, other = self.xfeat.match_lighterglue(output0, output1)
        
        # Scale keypoints back to original image size
        mkpts_0 = mkpts_0 / resize_factor
        mkpts_1 = mkpts_1 / resize_factor

        # Calculate homography using USAC_FAST algorithm with fewer iterations
        H, mask = cv2.findHomography(mkpts_0, mkpts_1, cv2.USAC_FAST, 3.0, maxIters=500, confidence=0.995)
        
        # Only generate visualization in debug mode or when needed
        if os.environ.get('DEBUG_VISUALIZATION', '0') == '1':
            # Calculate homography and create visualization
            canvas, _ = warp_corners_and_draw_matches(mkpts_0, mkpts_1, source_image, input_image)
            # Save the concatenated image with matches
            concatenated_image_path = os.path.join(os.getcwd(), 'concatenated_image_with_matches.jpg')
            cv2.imwrite(concatenated_image_path, canvas)

        return H