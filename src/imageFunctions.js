
let mFixedMat = null;
let mMovingMat = null;
let mImgAlign = null;

let mTransMat = null;
let mFixedPtsGood = null;
let mMovingPtsGood = null;
let mFixedPtsInlier = null;
let mMovingPtsInlier = null;

let mImgStitch = null;
let mMultiStitchImages = null;

export default {
    doCVStuff(mainImage, toAlignImage) {
        // Implementation used from this blog: https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript

        let im1Input = cv.matFromImageData(mainImage);
        let im2Input = cv.matFromImageData(toAlignImage);

        //im2 is the original reference image we are trying to align to
        let im2 = cv.matFromImageData(mainImage);
        //im1 is the image we are trying to line up correctly
        let im1 = cv.matFromImageData(toAlignImage);

        //17            Convert images to grayscale
        //18            Mat im1Gray, im2Gray;
        //19            cvtColor(im1, im1Gray, CV_BGR2GRAY);
        //20            cvtColor(im2, im2Gray, CV_BGR2GRAY);
        let im1Gray = new cv.Mat();
        let im2Gray = new cv.Mat();
        cv.cvtColor(im1, im1Gray, cv.COLOR_BGRA2GRAY);
        cv.cvtColor(im2, im2Gray, cv.COLOR_BGRA2GRAY);

        //22            Variables to store keypoints and descriptors
        //23            std::vector<KeyPoint> keypoints1, keypoints2;
        //24            Mat descriptors1, descriptors2;
        let keypoints1 = new cv.KeyPointVector();
        let keypoints2 = new cv.KeyPointVector();
        let descriptors1 = new cv.Mat();
        let descriptors2 = new cv.Mat();

        //26            Detect ORB features and compute descriptors.
        //27            Ptr<Feature2D> orb = ORB::create(MAX_FEATURES);
        //28            orb->detectAndCompute(im1Gray, Mat(), keypoints1, descriptors1);
        //29            orb->detectAndCompute(im2Gray, Mat(), keypoints2, descriptors2);
        var orb = new cv.ORB(5000);
        orb.detectAndCompute(im1Gray, new cv.Mat(), keypoints1, descriptors1);
        orb.detectAndCompute(im2Gray, new cv.Mat(), keypoints2, descriptors2);

        //31            Match features.
        //32            std::vector<DMatch> matches;
        //33            Ptr<DescriptorMatcher> matcher = DescriptorMatcher::create("BruteForce-Hamming");
        //34            matcher->match(descriptors1, descriptors2, matches, Mat());
        let bf = new cv.BFMatcher(cv.NORM_HAMMING, true);
        let matches = new cv.DMatchVector();
        bf.match(descriptors1, descriptors2, matches);

        //36            Sort matches by score
        //37            std::sort(matches.begin(), matches.end());
        //39            Remove not so good matches
        //40            const int numGoodMatches = matches.size() * GOOD_MATCH_PERCENT;
        //41            matches.erase(matches.begin()+numGoodMatches, matches.end());
        let good_matches = new cv.DMatchVector();
        for (let i = 0; i < matches.size(); i++) {
            if (matches.get(i).distance < 30) {
                good_matches.push_back(matches.get(i));
            }
        }

        //44            Draw top matches
        //45            Mat imMatches;
        //46            drawMatches(im1, keypoints1, im2, keypoints2, matches, imMatches);
        //47            imwrite("matches.jpg", imMatches);
        let imMatches = new cv.Mat();
        let color = new cv.Scalar(0, 255, 0, 255);
        cv.drawMatches(im1, keypoints1, im2, keypoints2, good_matches, imMatches, color);

        //50            Extract location of good matches
        //51            std::vector<Point2f> points1, points2;
        //53            for( size_t i = 0; i < matches.size(); i++ )
        //54            {
        //55                points1.push_back( keypoints1[ matches[i].queryIdx ].pt );
        //56                points2.push_back( keypoints2[ matches[i].trainIdx ].pt );
        //57            }

        let points1 = [];
        let points2 = [];

        for (let i = 0; i < good_matches.size(); i++) {
            let keyPoint1 = keypoints1.get(good_matches.get(i).queryIdx);
            let keyPoint2 = keypoints2.get(good_matches.get(i).trainIdx);
            console.log("Keypoint 1: ", keyPoint1);
            points1.push(keyPoint1.pt.x);
            points1.push(keyPoint1.pt.y);
            points2.push(keyPoint2.pt.x);
            points2.push(keyPoint2.pt.y);
        }

        //59            Find homography
        //60            h = findHomography( points1, points2, RANSAC );
        //The first 2 arguments to findHomography need to be matArray so you must convert your point1 and point2 to matArray
        //reference: https://docs.opencv.org/3.4/d9/d0c/group__calib3d.html#ga4abc2ece9fab9398f2e560d53c8c9780

        // points1 = [10, 10, 20, 10, 10, 20, 20, 20]

        // Make points2 a translation of points1 by (-10,-10) and a scale of 1/2
        // points2 = [0, 0, 5, 0, 0, 5, 5, 5]

        var mat1 = new cv.Mat(points1.length / 2, 1, cv.CV_32FC2);
        mat1.data32F.set(points1);
        var mat2 = new cv.Mat(points2.length / 2, 1, cv.CV_32FC2);
        mat2.data32F.set(points2);
        let h = cv.findHomography(mat1, mat2, cv.RANSAC);

        console.log(mat1);
        console.log(mat2);
        console.log(h);

        //62          Use homography to warp image
        //63          warpPerspective(im1, im1Reg, h, im2.size());
        let image_B_final_result = new cv.Mat();
        cv.warpPerspective(im1, image_B_final_result, h, im2.size());

        // Create a new image that has both im2 and image_B_final_result
        let image_A_final_result = new cv.Mat();
        cv.addWeighted(im2, 0.5, image_B_final_result, 0.5, 0, image_A_final_result);

        // Get four points that are the corners of im1
        let corners = new cv.Mat(4, 1, cv.CV_32FC2);
        corners.data32F[0] = 0;
        corners.data32F[1] = 0;
        corners.data32F[2] = im1.cols;
        corners.data32F[3] = 0;
        corners.data32F[4] = im1.cols;
        corners.data32F[5] = im1.rows;
        corners.data32F[6] = 0;
        corners.data32F[7] = im1.rows;

        // Transform the corners of im2 to the corners of im1
        let cornersTransformed = new cv.Mat(4, 1, cv.CV_32FC2);
        cv.perspectiveTransform(corners, cornersTransformed, h);

        // Draw the new corners on image_B_final_result
        cv.line(image_A_final_result, {x: cornersTransformed.data32F[0], y: cornersTransformed.data32F[1]}, {x: cornersTransformed.data32F[2], y: cornersTransformed.data32F[3]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(image_A_final_result, {x: cornersTransformed.data32F[2], y: cornersTransformed.data32F[3]}, {x: cornersTransformed.data32F[4], y: cornersTransformed.data32F[5]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(image_A_final_result, {x: cornersTransformed.data32F[4], y: cornersTransformed.data32F[5]}, {x: cornersTransformed.data32F[6], y: cornersTransformed.data32F[7]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(image_A_final_result, {x: cornersTransformed.data32F[6], y: cornersTransformed.data32F[7]}, {x: cornersTransformed.data32F[0], y: cornersTransformed.data32F[1]}, new cv.Scalar(0, 255, 0, 255), 2);

        // Turn imMatches mat into ImageData
        return [imMatches, image_A_final_result];
    }
}