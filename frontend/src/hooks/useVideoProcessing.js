import { useEffect, useRef } from "react";

/**
 * Custom hook for processing video frames with WatVision
 * @param {Object} params - Parameters for video processing
 * @param {Object} params.watVision - WatVision instance
 * @param {boolean} params.videoLoaded - Whether video metadata is loaded
 * @param {React.RefObject} params.videoRef - Video element ref
 * @param {React.RefObject} params.videoCanvas - Canvas element ref
 * @param {boolean} params.trackingScreen - Whether screen tracking is active
 * @param {Function} params.setLoading - Function to set loading state
 * @param {Function} params.setError - Function to set error state
 */
export function useVideoProcessing({ 
    watVision, 
    videoLoaded, 
    videoRef, 
    videoCanvas, 
    trackingScreen, 
    setLoading, 
    setError 
}) {
    const processingRef = useRef(false);

    useEffect(() => {
        if (!watVision || !videoLoaded) {
            return;
        }

        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;
        if (!videoEl || !videoCanvasEl) return;

        let animationFrameId;

        const processFrame = async () => {
            // Skip if we're already processing a frame or video has ended
            if (processingRef.current || videoEl.ended || videoEl.paused) {
                animationFrameId = requestAnimationFrame(processFrame);
                return;
            }

            processingRef.current = true;

            try {
                // Make sure the video has enough data
                if (videoEl.readyState < 2) {
                    processingRef.current = false;
                    animationFrameId = requestAnimationFrame(processFrame);
                    return;
                }

                // Draw the current video frame to canvas
                videoCanvasEl.width = videoEl.videoWidth;
                videoCanvasEl.height = videoEl.videoHeight;
                const ctx = videoCanvasEl.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

                // Process this frame with WatVision
                await watVision.step();

                setLoading(false);
            } catch (err) {
                console.error("Error processing frame:", err);
                setError(err);
            } finally {
                processingRef.current = false;
                animationFrameId = requestAnimationFrame(processFrame);
            }
        };

        // Start the frame processing loop
        animationFrameId = requestAnimationFrame(processFrame);

        // Cleanup function
        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [watVision, videoLoaded, trackingScreen, videoRef, videoCanvas, setLoading, setError]);
}
