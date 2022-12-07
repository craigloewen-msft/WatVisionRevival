export default {
    copyOver(source, destination, homographyMat) {
        // From here: https://stackoverflow.com/questions/13063201/how-to-show-the-whole-image-when-using-opencv-warpperspective
        // '''warp img2 to img1 with homograph H'''
        // h1,w1 = img1.shape[:2]
        // h2,w2 = img2.shape[:2]
        // pts1 = float32([[0,0],[0,h1],[w1,h1],[w1,0]]).reshape(-1,1,2)
        // pts2 = float32([[0,0],[0,h2],[w2,h2],[w2,0]]).reshape(-1,1,2)
        // pts2_ = cv2.perspectiveTransform(pts2, H)
        // pts = concatenate((pts1, pts2_), axis=0)
        // [xmin, ymin] = int32(pts.min(axis=0).ravel() - 0.5)
        // [xmax, ymax] = int32(pts.max(axis=0).ravel() + 0.5)
        // t = [-xmin,-ymin]
        // Ht = array([[1,0,t[0]],[0,1,t[1]],[0,0,1]]) # translate

        // result = cv2.warpPerspective(img2, Ht.dot(H), (xmax-xmin, ymax-ymin))
        // result[t[1]:h1+t[1],t[0]:w1+t[0]] = img1
        // return result

        // Rewrite the above code in Javascript
        const h1 = source.rows;
        const w1 = source.cols;
        const h2 = destination.rows;
        const w2 = destination.cols;

        const pts1 = new cv.Mat(4, 1, cv.CV_32FC2);
        const pts2 = new cv.Mat(4, 1, cv.CV_32FC2);

        pts1.data32F[0] = 0;
        pts1.data32F[1] = 0;
        pts1.data32F[2] = 0;
        pts1.data32F[3] = h1;

        pts1.data32F[4] = w1;
        pts1.data32F[5] = h1;
        pts1.data32F[6] = w1;
        pts1.data32F[7] = 0;

        pts2.data32F[0] = 0;
        pts2.data32F[1] = 0;
        pts2.data32F[2] = 0;
        pts2.data32F[3] = h2;

        pts2.data32F[4] = w2;
        pts2.data32F[5] = h2;
        pts2.data32F[6] = w2;
        pts2.data32F[7] = 0;

        const pts2_ = new cv.Mat();
        cv.perspectiveTransform(pts2, pts2_, homographyMat);

        // Reshape pts1 and pts2_ to x and y vectors
        const pts1MatVector = new cv.MatVector();
        cv.split(pts1, pts1MatVector);

        const pts2MatVector = new cv.MatVector();
        cv.split(pts2_, pts2MatVector);

        // Get value of pts1_ at index 0
        const pts1_x = pts1MatVector.get(0);
        const pts1_y = pts1MatVector.get(1);

        const pts2_x = pts2MatVector.get(0);
        const pts2_y = pts2MatVector.get(1);

        // Concatenate pts1 and pts2
        const XPtsVector = new cv.MatVector();
        XPtsVector.push_back(pts1_x);
        XPtsVector.push_back(pts2_x);

        const YPtsVector = new cv.MatVector();
        YPtsVector.push_back(pts1_y);
        YPtsVector.push_back(pts2_y);

        const allXPts = new cv.Mat();
        cv.vconcat(XPtsVector, allXPts);

        const allYPts = new cv.Mat();
        cv.vconcat(YPtsVector, allYPts);

        let xMinMax = cv.minMaxLoc(allXPts);
        let yMinMax = cv.minMaxLoc(allYPts);

        const xmin = xMinMax.minVal; 
        const ymin = yMinMax.minVal;

        const xmax = xMinMax.maxVal;
        const ymax = yMinMax.maxVal;

        const t = [-xmin, -ymin];

        const Ht = new cv.Mat(3, 3, cv.CV_64FC1);
        Ht.data64F[0] = 1;
        Ht.data64F[1] = 0;
        Ht.data64F[2] = t[0];

        Ht.data64F[3] = 0;
        Ht.data64F[4] = 1;
        Ht.data64F[5] = t[1];

        Ht.data64F[6] = 0;
        Ht.data64F[7] = 0;
        Ht.data64F[8] = 1;

        // Cross multiply Ht and homographyMat
        let translatedHomographyMat = new cv.Mat();
        cv.gemm(Ht, homographyMat, 1, new cv.Mat(), 0, translatedHomographyMat);

        const result = new cv.Mat();
        cv.warpPerspective(destination, result, translatedHomographyMat, new cv.Size(xmax - xmin, ymax - ymin));

        const roi = new cv.Rect(t[0], t[1], w1, h1);
        const destinationROI = result.roi(roi);
        source.copyTo(destinationROI);

        // Get four points that are the corners of destination
        const corners = new cv.Mat(4, 1, cv.CV_32FC2);
        corners.data32F[0] = 0;
        corners.data32F[1] = 0;
        corners.data32F[2] = 0;
        corners.data32F[3] = h2;

        corners.data32F[4] = w2;
        corners.data32F[5] = h2;
        corners.data32F[6] = w2;
        corners.data32F[7] = 0;

        // Transform the corners of destination to the new coordinate system
        let cornersTransformed = new cv.Mat(4, 1, cv.CV_32FC2);
        cv.perspectiveTransform(corners, cornersTransformed, translatedHomographyMat);

        // // Draw the new corners on result
        cv.line(result, {x: cornersTransformed.data32F[0], y: cornersTransformed.data32F[1]}, {x: cornersTransformed.data32F[2], y: cornersTransformed.data32F[3]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(result, {x: cornersTransformed.data32F[2], y: cornersTransformed.data32F[3]}, {x: cornersTransformed.data32F[4], y: cornersTransformed.data32F[5]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(result, {x: cornersTransformed.data32F[4], y: cornersTransformed.data32F[5]}, {x: cornersTransformed.data32F[6], y: cornersTransformed.data32F[7]}, new cv.Scalar(0, 255, 0, 255), 2);
        cv.line(result, {x: cornersTransformed.data32F[6], y: cornersTransformed.data32F[7]}, {x: cornersTransformed.data32F[0], y: cornersTransformed.data32F[1]}, new cv.Scalar(0, 255, 0, 255), 2);

        return [result,translatedHomographyMat];
    },
    alignTwoImages(mainImage, toAlignImage) {
        // Implementation used from this blog: https://scottsuhy.com/2021/02/01/image-alignment-feature-based-in-opencv-js-javascript

        let im1Input = cv.matFromImageData(mainImage);
        let im2Input = cv.matFromImageData(toAlignImage);

        //im2 is the original reference image we are trying to align to
        let mainImageMat = cv.matFromImageData(mainImage);
        //im1 is the image we are trying to line up correctly
        let toAlignImageMat = cv.matFromImageData(toAlignImage);

        //17            Convert images to grayscale
        //18            Mat im1Gray, im2Gray;
        //19            cvtColor(im1, im1Gray, CV_BGR2GRAY);
        //20            cvtColor(im2, im2Gray, CV_BGR2GRAY);
        let toAlignImageGray = new cv.Mat();
        let mainImageGray = new cv.Mat();
        cv.cvtColor(toAlignImageMat, toAlignImageGray, cv.COLOR_BGRA2GRAY);
        cv.cvtColor(mainImageMat, mainImageGray, cv.COLOR_BGRA2GRAY);

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
        orb.detectAndCompute(toAlignImageGray, new cv.Mat(), keypoints1, descriptors1);
        orb.detectAndCompute(mainImageGray, new cv.Mat(), keypoints2, descriptors2);

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
        cv.drawMatches(toAlignImageMat, keypoints1, mainImageMat, keypoints2, good_matches, imMatches, color);

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
            points1.push(keyPoint1.pt.x);
            points1.push(keyPoint1.pt.y);
            points2.push(keyPoint2.pt.x);
            points2.push(keyPoint2.pt.y);
        }

        var mat1 = new cv.Mat(points1.length / 2, 1, cv.CV_32FC2);
        mat1.data32F.set(points1);
        var mat2 = new cv.Mat(points2.length / 2, 1, cv.CV_32FC2);
        mat2.data32F.set(points2);
        let homographyMat = cv.findHomography(mat1, mat2, cv.RANSAC);

        let inverseHomographyMat = cv.findHomography(mat2, mat1, cv.RANSAC);

        let warpedPerspectiveImage = new cv.Mat();
        cv.warpPerspective(toAlignImageMat, warpedPerspectiveImage, homographyMat, mainImageMat.size());

        let blendedImage = new cv.Mat();
        cv.addWeighted(mainImageMat, 0.5, warpedPerspectiveImage, 0.5, 0, blendedImage);

        // let [combinedImage,translatedHomographyMat] = this.copyOver(mainImageMat, toAlignImageMat,homographyMat);

        // Draw the outlines of the moving image onto the main image
        let combinedImage = new cv.Mat();

        return [combinedImage, homographyMat, inverseHomographyMat];
    },
    perspectiveTransformWithMat: function (mainPoint, homographyMat) {
        const inPoint = new cv.Mat(1, 1, cv.CV_32FC2);
        inPoint.data32F[0] = mainPoint.x;
        inPoint.data32F[1] = mainPoint.y;

        // Transform the corners of destination to the new coordinate system
        let outPoint = new cv.Mat();
        cv.perspectiveTransform(inPoint, outPoint, homographyMat);
        return {x: outPoint.data32F[0], y: outPoint.data32F[1]};
    },
    perspectiveTransformArrayWithMat: function (mainPointArray, homographyMat) {
        try {
        const inPoint = new cv.Mat(mainPointArray.length, 1, cv.CV_32FC2);
        for (let i = 0; i < mainPointArray.length; i++) {
            inPoint.data32F[i * 2] = mainPointArray[i].x;
            inPoint.data32F[i * 2 + 1] = mainPointArray[i].y;
        }

        // Transform the corners of destination to the new coordinate system
        let outPoint = new cv.Mat();
        cv.perspectiveTransform(inPoint, outPoint, homographyMat);
        let outPointArray = [];
        for (let i = 0; i < mainPointArray.length; i++) {
            outPointArray.push({x: outPoint.data32F[i * 2], y: outPoint.data32F[i * 2 + 1]});
        }
        return outPointArray;
    } catch (error) {
        console.log("Error while transforming array with mat");
        console.log(error);
    }
    }
}