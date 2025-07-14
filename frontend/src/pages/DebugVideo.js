import React, { useEffect, useRef, useState } from "react";
import { useWatVision } from "../hooks/useWatVision";
import { useVideoProcessing } from "../hooks/useVideoProcessing";
import { DebugControls, DebugImages } from "../components/DebugShared";

function DebugVideo() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const [videoLoaded, setVideoLoaded] = useState(false);

    // Use shared WatVision hook
    const {
        watVision,
        loading,
        setLoading,
        error,
        setError,
        trackingScreen,
        isRecording,
        interimText,
        speechError,
        sessionId,
        toggleSpeechRecognition,
        explainScreen,
        toggleTrackingScreen,
        requestStartTrackingTouchScreen
    } = useWatVision({
        videoCanvas,
        debugInputImageRef,
        debugReferenceImageRef
    });

    // Use shared video processing hook
    useVideoProcessing({
        watVision,
        videoLoaded,
        videoRef,
        videoCanvas,
        trackingScreen,
        setLoading,
        setError
    });

    // Handle video loading
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

    // Return the component JSX
    return (
        <div className="container">
            <h3>Video Debug Page</h3>
            
            <DebugControls 
                watVision={watVision}
                loading={loading}
                error={error}
                isRecording={isRecording}
                speechError={speechError}
                interimText={interimText}
                sessionId={sessionId}
                trackingScreen={trackingScreen}
                toggleSpeechRecognition={toggleSpeechRecognition}
                toggleTrackingScreen={toggleTrackingScreen}
                explainScreen={explainScreen}
                requestStartTrackingTouchScreen={requestStartTrackingTouchScreen}
            />
            
            <div className="row">
                <div className="col-6">
                    <h3>Input Video</h3>
                    <video
                        ref={videoRef}
                        src="/input-small.mp4"
                        className="img-fluid"
                        controls
                        loop
                        autoPlay
                        muted
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

export default DebugVideo;
