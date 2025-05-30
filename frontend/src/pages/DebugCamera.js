import React, { useEffect, useRef, useState, useMemo } from "react";
import WatVision from "../js/watvision";

function DebugCamera() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    // Use useMemo to prevent recreation of WatVision instance on each render
    const watVision = useMemo(() => new WatVision(), []);

    const [videoLoaded, setVideoLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSourceCaptured, setIsSourceCaptured] = useState(false);
    const [processingActive, setProcessingActive] = useState(false);
    const processingRef = useRef(false); // Use a ref to track processing state across renders

    // Request webcam access and set the video element's source
    useEffect(() => {
        async function setupWebcam() {
            try {
                if (!navigator.mediaDevices) {
                    throw new Error("Media Devices API not supported in this browser or requires HTTPS/localhost context");
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: "environment",
                    }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error("Error accessing webcam: ", err);
                setError(err);
            }
        }
        setupWebcam();
    }, []);

    // Detect when video metadata is loaded (dimensions etc.)
    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        const handleLoadedData = () => {
            console.log("Video data loaded");
            setVideoLoaded(true);
        };

        videoEl.addEventListener("loadeddata", handleLoadedData);
        return () => {
            videoEl.removeEventListener("loadeddata", handleLoadedData);
        };
    }, []);

    // Capture initial source image when "Capture Source" button is clicked
    const captureSource = async () => {
        if (!watVision || !videoLoaded) return;

        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;

        try {
            // Draw the current video frame to canvas
            videoCanvasEl.width = videoEl.videoWidth;
            videoCanvasEl.height = videoEl.videoHeight;
            const ctx = videoCanvasEl.getContext("2d");
            ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

            // Capture this frame as the source image
            await watVision.captureSourceImage(videoCanvasEl);
            setIsSourceCaptured(true);
            console.log("Source image captured successfully");
        } catch (err) {
            console.error("Error capturing source image:", err);
            setError(err);
        }
    };

    // Toggle video processing on/off
    const toggleProcessing = () => {
        setProcessingActive(prev => !prev);
    };

    // Process video frames
    useEffect(() => {
        if (!watVision || !videoLoaded || !isSourceCaptured || !processingActive) {
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
                // Draw the current video frame to canvas
                videoCanvasEl.width = videoEl.videoWidth;
                videoCanvasEl.height = videoEl.videoHeight;
                const ctx = videoCanvasEl.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

                // Process this frame with WatVision
                await watVision.step(
                    videoCanvasEl,
                    debugInputImageRef.current,
                    debugReferenceImageRef.current
                );

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
    }, [watVision, videoLoaded, isSourceCaptured, processingActive]);

    return (
        <div className="container">
            <h3>Debug Camera</h3>
            <div className="row">
                <div>
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error.message}</p>
                    ) : null}
                </div>
            </div>
            <div className="row mb-3">
                <div className="col-12">
                    <button
                        className="btn btn-primary mr-2"
                        onClick={captureSource}
                        disabled={!watVision || !videoLoaded || isSourceCaptured}>
                        Capture Source Frame
                    </button>
                    <button
                        className={`btn ${processingActive ? 'btn-danger' : 'btn-success'} ml-2`}
                        onClick={toggleProcessing}
                        disabled={!isSourceCaptured}>
                        {processingActive ? 'Stop Processing' : 'Start Processing'}
                    </button>
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Webcam Input</h3>
                    <video
                        ref={videoRef}
                        className="img-fluid"
                        muted
                        autoPlay
                        playsInline
                        style={{ maxWidth: "100%" }}
                    />
                </div>
                <div className="col-6">
                    <h3>Video Canvas</h3>
                    <canvas ref={videoCanvas} className="img-fluid" />
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Debug Input Image</h3>
                    <img ref={debugInputImageRef} className="img-fluid" alt="Input with processing" />
                </div>
                <div className="col-6">
                    <h3>Debug Source Image</h3>
                    <img ref={debugReferenceImageRef} className="img-fluid" alt="Source reference" />
                </div>
            </div>
        </div>
    );
}

export default DebugCamera;
