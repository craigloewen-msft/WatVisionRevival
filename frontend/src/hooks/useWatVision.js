import { useEffect, useState } from "react";
import WatVision from "../js/watvision";

/**
 * Custom hook for managing WatVision instance and related state
 * @param {Object} refs - Object containing canvas and image refs
 * @param {React.RefObject} refs.videoCanvas - Canvas ref for video processing
 * @param {React.RefObject} refs.debugInputImageRef - Input image ref for debugging
 * @param {React.RefObject} refs.debugReferenceImageRef - Reference image ref for debugging
 */
export function useWatVision({ videoCanvas, debugInputImageRef, debugReferenceImageRef }) {
    const [watVision, setWatVision] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sourceImageCaptured, setSourceImageCaptured] = useState(false);

    // Speech recognition states
    const [isRecording, setIsRecording] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [speechError, setSpeechError] = useState(null);
    const [sessionId, setSessionId] = useState(null);

    // Screen info states
    const [screenDescription, setScreenDescription] = useState(null);
    const [textElements, setTextElements] = useState(null);
    const [trackedElementIndex, setTrackedElementIndex] = useState(null);

    // Initialize WatVision after refs are available
    useEffect(() => {
        if (videoCanvas.current && debugInputImageRef.current && debugReferenceImageRef.current) {
            console.log("Creating WatVision instance...");
            
            const watVisionInstance = new WatVision(
                videoCanvas.current,
                debugInputImageRef.current,
                debugReferenceImageRef.current
            );

            // Set up event handlers
            watVisionInstance.setOnConnected((sessionId) => {
                setSessionId(sessionId);
                setSpeechError(null);
            });

            watVisionInstance.setOnDisconnect(() => {
                console.log("Disconnected from speech client");
                setSessionId(null);
                setIsRecording(false);
                setSpeechError("Disconnected from speech client");
            });

            watVisionInstance.setOnError((error) => {
                console.error("Speech recognition error:", error);
                setSpeechError(error.message || "Speech recognition error");
                setIsRecording(false);
            });

            watVisionInstance.setOnSessionStarted(() => {
                console.log("Speech recognition session started");
                setSpeechError(null);
            });

            watVisionInstance.setOnSessionStopped(() => {
                console.log("Speech recognition session stopped");
                setSessionId(null);
            });

            // Set up unified callback for all displayed value updates
            watVisionInstance.setOnDisplayedValueUpdates((instance) => {
                setInterimText(instance.audioTranscriptText);
                setScreenDescription(instance.last_received_screen_description);
                setTextElements(instance.last_received_text_elements);
                setSourceImageCaptured(instance.sourceImageCaptured);
                setTrackedElementIndex(instance.trackedElementIndex);
            });

            watVisionInstance.connect();

            setWatVision(watVisionInstance);

            console.log("WatVision instance created with refs:", {
                videoCanvas: videoCanvas.current,
                debugInputImageRef: debugInputImageRef.current,
                debugReferenceImageRef: debugReferenceImageRef.current
            });

            // Cleanup on unmount
            return () => {
                console.log("Cleaning up WatVision instance...");
                watVisionInstance.disconnect();
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array means this runs once after initial render

    // Toggle speech recognition
    const toggleSpeechRecognition = async () => {
        if (!watVision) return;

        if (!isRecording) {
            try {
                await watVision.startSession();
                setIsRecording(true);
                setSpeechError(null);
            } catch (err) {
                console.error("Failed to start recording:", err);
                setSpeechError("Failed to start recording");
            }
        } else {
            if (watVision) {
                watVision.stopSession();
            }
            setIsRecording(false);
        }
    };

    const explainScreen = async () => {
        if (!watVision) return;
        await watVision.explainScreen();
    };

    const captureScreen = async () => {
        if (!watVision) return;
        try {
            await watVision.captureSourceImage();
        } catch (err) {
            console.error("Failed to capture screen:", err);
            setError(err);
        }
    };

    // Track a specific element by index
    const trackElement = async (elementIndex) => {
        if (!watVision) return;
        
        console.log(`Tracking element at index: ${elementIndex}`);
        await watVision.trackElement(elementIndex);
        await watVision.startTrackingScreen();
    };

    // Stop tracking the current element
    const stopTrackingElement = async () => {
        if (!watVision) return;
        
        console.log('Stopping element tracking');
        await watVision.clearTrackedElement();
        watVision.stopTrackingScreen();
    };

    return {
        watVision,
        loading,
        setLoading,
        error,
        setError,
        sourceImageCaptured,
        isRecording,
        interimText,
        speechError,
        sessionId,
        screenDescription,
        textElements,
        trackedElementIndex,
        toggleSpeechRecognition,
        explainScreen,
        captureScreen,
        trackElement,
        stopTrackingElement,
    };
}
