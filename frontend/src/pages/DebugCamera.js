import React, { useEffect, useRef, useState } from "react";
import { useVideoProcessing } from "../hooks/useVideoProcessing";
import { useWatVisionDebugWrapper } from "../components/WatVisionDebugWrapper";
import { DebugControls, DebugImages } from '../components/DebugShared';

function DebugCamera() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const [videoLoaded, setVideoLoaded] = useState(false);

    // Use the hook-based wrapper to get WatVision state
    const watVisionProps = useWatVisionDebugWrapper({
        videoCanvas,
        debugInputImageRef,
        debugReferenceImageRef
    });

    const { watVision, setLoading, setError } = watVisionProps;

    // Use shared video processing hook
    useVideoProcessing({
        watVision,
        videoLoaded,
        videoRef,
        videoCanvas,
        setLoading,
        setError
    });

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
    }, [setError]);

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

    return (
        <div className="container">
            <h3>Debug Camera</h3>
            
            <DebugControls {...watVisionProps} />
            
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
            
            <DebugImages 
                debugInputImageRef={debugInputImageRef}
                debugReferenceImageRef={debugReferenceImageRef}
            />
        </div>
    );
}

export default DebugCamera;
