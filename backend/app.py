from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import traceback
import asyncio
import base64
from typing import Dict, List
from contextlib import asynccontextmanager
import uuid

from vision_manager import VisionManager
from dotenv import load_dotenv

load_dotenv()

vision_manager = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    global vision_manager
    
    # Startup
    print("Starting up FastAPI application...")
    vision_manager = VisionManager()
    yield
    
    # Shutdown
    print("Shutting down FastAPI application...")

# Create FastAPI app
app = FastAPI(
    title="WatVision API",
    description="Computer Vision API with WebSocket support",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine the port and environment
if os.getenv('NODE_ENV') == "production":
    host_port = int(os.getenv('PORT', 3000))
    print("Running as production!")
else:
    host_port = int(os.getenv('PORT', 8080))
    print("Running as development!")

# # Check for SSL certificate files
# cert_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.crt')
# key_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.key')
# ssl_context = None

# if os.path.exists(cert_path) and os.path.exists(key_path):
#     ssl_context = (cert_path, key_path)
#     print("SSL certificates found, HTTPS enabled")
# else:
#     print("SSL certificates not found, running without HTTPS")

# Mount static files
app.mount("/dist", StaticFiles(directory="dist"), name="static")

# API Routes
@app.get("/api/")
async def api_root():
    """Health check endpoint"""
    return {"success": True, "message": "API is working!"}

@app.post("/api/explain_screen/")
async def explain_screen(session_id: str = Form(...)):
    """Get current image description"""
    try:
        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")

        result = vision_manager.get_current_image_description(session_id)
        return {"success": True, "data": result}
    
    except Exception as e:
        print(f'Error in explain_screen: {e}')
        print(f'Traceback:\n{traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))

# @app.post("/api/set_source_image/")
# async def set_source_image(
#     session_id: str = Form(...),
#     source: UploadFile = File(...)
# ):
#     """Set source image for comparison"""
#     try:
#         if not session_id:
#             raise HTTPException(status_code=400, detail="Session ID is required")
        
#         if not source:
#             raise HTTPException(status_code=400, detail="No source file provided")
        
#         result = await vision_manager.set_source_image(session_id, source)

#         return {"success": True, "data": result}
    
#     except Exception as e:
#         print(f'Error in set_source_image: {e}')
#         print(f'Traceback:\n{traceback.format_exc()}')
#         raise HTTPException(status_code=500, detail=str(e))

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time communication"""
    print("Got websocket connection")
    await websocket.accept()
    
    # Generate ranodm session ID
    session_id = str(uuid.uuid4())
    print(f'Client connected: {session_id}')
    
    try:
        # Add connection to vision manager
        vision_manager.add_connection(session_id, websocket)
        
        # Send connection confirmation
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id
        })
        
        # Handle incoming messages
        while True:
            try:
                data = await websocket.receive_json()
                await handle_websocket_message(session_id, data, websocket)
            except WebSocketDisconnect as e:
                raise WebSocketDisconnect
            except Exception as e:
                print(f"Error handling WebSocket message for {session_id}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": str(e)
                })
                
    except WebSocketDisconnect:
        print(f'Client disconnected: {session_id}')
    except Exception as e:
        print(f'WebSocket error for {session_id}: {e}')
        print(f'Traceback:\n{traceback.format_exc()}')
    finally:
        # Clean up
        await vision_manager.remove_connection(session_id)

async def handle_websocket_message(session_id: str, data: dict, websocket: WebSocket):
    """Handle different types of WebSocket messages"""
    message_type = data.get("type", "")
    
    try:
        if message_type == "start_session":
            print(f'Starting recognition for session {session_id}')
            await vision_manager.start_session(session_id)
            
        elif message_type == "stop_session":
            print(f'Stopping recognition for session {session_id}')
            await vision_manager.stop_session(session_id)
            
        elif message_type == "audio_chunk":
            # Handle incoming audio chunks
            audio_data = data.get("audio", "")
            if isinstance(audio_data, str):
                audio_data = base64.b64decode(audio_data)
            await vision_manager.process_audio_chunk(session_id, audio_data)
            
        elif message_type == "debug_request_start_tracking_touchscreen":
            print(f'Starting touchscreen tracking for session {session_id}')
            await websocket.send_json({
                "type": "start_tracking_touchscreen"
            })

        elif message_type == "step":
            source_image = data.get("image", None)
            if not source_image:
                raise ValueError("Source image is required")
            
            # Decode base64 image
            source_image_bytes = base64.b64decode(source_image)
            
            result = vision_manager.step(session_id, source_image_bytes)
            await websocket.send_json({
                "type": "step_response",
                "data": result
            })


        elif message_type == "set_source_image":
            source_image = data.get("image", None)
            if not source_image:
                raise ValueError("Source image is required")
            
            # Decode base64 image
            source_image_bytes = base64.b64decode(source_image)
            
            result = await vision_manager.set_source_image(session_id, source_image_bytes)
            await websocket.send_json({
                "type": "source_image_set",
                "data": result
            })
            
        else:
            print(f'Unhandled message type {message_type} for session {session_id}')
            
    except Exception as e:
        print(f'Error handling message type {message_type}: {e}')
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=host_port,
        reload=True
    )