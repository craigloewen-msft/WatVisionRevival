import React from 'react';
import { useWatVision } from '../hooks/useWatVision';
import { DebugControls, DebugImages } from './DebugShared';

/**
 * Wrapper component that provides WatVision functionality to debug pages
 * This component encapsulates the common WatVision state and UI, reducing repetition
 * across different debug pages while maintaining clean separation of concerns.
 */
export function WatVisionDebugWrapper({ 
    children, 
    videoCanvas, 
    debugInputImageRef, 
    debugReferenceImageRef 
}) {
    const watVisionProps = useWatVision({
        videoCanvas,
        debugInputImageRef,
        debugReferenceImageRef
    });

    return (
        <>
            <DebugControls {...watVisionProps} />
            {children}
            <DebugImages 
                debugInputImageRef={debugInputImageRef}
                debugReferenceImageRef={debugReferenceImageRef}
            />
        </>
    );
}

/**
 * Hook-based wrapper that provides WatVision state for components that need direct access
 * Use this when you need to access WatVision state in your component
 */
export function useWatVisionDebugWrapper({ videoCanvas, debugInputImageRef, debugReferenceImageRef }) {
    return useWatVision({
        videoCanvas,
        debugInputImageRef,
        debugReferenceImageRef
    });
}
