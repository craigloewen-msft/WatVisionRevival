import React, { useEffect, useRef, useState } from "react";
import WatVision from "../js/watvision";

function DebugCamera() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const [watVision, setWatVision] = useState(null);
    const [videoLoaded, setVideoLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Request webcam access and set the video element's source
    useEffect(() => {
        async function setupWebcam() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
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
            setVideoLoaded(true);
        };

        videoEl.addEventListener("loadeddata", handleLoadedData);
        return () => {
            videoEl.removeEventListener("loadeddata", handleLoadedData);
        };
    }, []);

    useEffect(() => {
        async function initWatVision() {
            let vision = new WatVision();
            await vision.init();
            setWatVision(vision);
        }
        initWatVision();
    }, []);

    useEffect(() => {
        if (!watVision || !videoLoaded) {
            console.log("Vision not ready yet");
            return;
        }
        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;
        if (!videoEl) return;

        // Process webcam stream frames
        const processFrame = async () => {
            if (videoEl.paused || videoEl.ended) return;
            try {
                videoCanvasEl.width = videoEl.videoWidth;
                videoCanvasEl.height = videoEl.videoHeight;
                const videoCanvasContext = videoCanvasEl.getContext("2d");
                videoCanvasContext.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

                // Capture the first frame as the source reference image, if not already set.
                if (!watVision.doesSourceImageExist()) {
                    try {
                        await watVision.captureSourceImage(videoCanvasEl);
                    } catch (err) {
                        console.error(err);
                        setError(err);
                    }
                }

                // Process the current frame with watVision
                watVision.step(
                    videoCanvasEl,
                    debugInputImageRef.current,
                    debugReferenceImageRef.current
                );
            } catch (err) {
                console.error(err);
                setError(err);
            }
            requestAnimationFrame(processFrame);
        };

        // Start processing frames
        processFrame();
        setLoading(false);
    }, [watVision, videoLoaded]);

    return (
        <div className="container">
            <h3>Debug page</h3>
            <div className="row">
                <div>
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error.message}</p>
                    ) : null}
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Webcam Input</h3>
                    <video
                        ref={videoRef}
                        // Removed src attribute as we use webcam stream instead.
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
                    <canvas className="img-fluid" ref={debugInputImageRef} />
                </div>
                <div className="col-6">
                    <h3>Debug Source Image</h3>
                    <canvas className="img-fluid" ref={debugReferenceImageRef} />
                </div>
            </div>
        </div>
    );
}

export default DebugCamera;
