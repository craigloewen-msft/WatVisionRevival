from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Form
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import traceback
import base64
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
    host_port = int(os.getenv('PORT', 8000))
    print("Running as development!")

# Check for SSL certificate files
cert_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.crt')
key_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.key')
ssl_keyfile = None
ssl_certfile = None

if os.path.exists(cert_path) and os.path.exists(key_path):
    ssl_keyfile = key_path
    ssl_certfile = cert_path
    print("SSL certificates found, HTTPS enabled")
else:
    print("SSL certificates not found, running without HTTPS")

# API Routes
@app.get("/api")
async def api_root():
    """Health check endpoint"""
    return {"success": True, "message": "API is working!"}

@app.get("/api/version")
async def get_version():
    """Get version information including git commit hash"""
    git_commit = os.getenv('GIT_COMMIT', 'env-not-set')
    return {
        "success": True,
        "data": {
            "git_commit": git_commit,
        }
    }

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
    print(f'Received message type: {message_type}')
    
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
            
        elif message_type == "step":
            await vision_manager.step(session_id, data)

        elif message_type == "set_source_image":
            source_image = data.get("image", None)
            if not source_image:
                raise ValueError("Source image is required")
            
            # Decode base64 image
            source_image_bytes = base64.b64decode(source_image)
            
            print(f'Setting source image for session {session_id}')
            await vision_manager.set_source_image(session_id, source_image_bytes)

        elif message_type == "send_screen_info":
            print(f'Sending screen info for session {session_id}')
            screen_info = await vision_manager.get_screen_info(session_id)
            await websocket.send_json({
                "type": "screen_info_response",
                "data": screen_info
            })

        elif message_type == "track_element":
            element_index = data.get("element_index")
            if element_index is None:
                raise ValueError("Element index is required for tracking")
            
            print(f'Tracking element at index {element_index} for session {session_id}')
            await vision_manager.track_element(session_id, element_index)
            
        elif message_type == "clear_tracked_element":
            print(f'Clearing element tracking for session {session_id}')
            await vision_manager.clear_tracked_element(session_id)

        else:
            print(f'Unhandled message type {message_type} for session {session_id}')
            
    except Exception as e:
        print(f'Error handling message type {message_type}: {e}')
        print(f'Traceback:\n{traceback.format_exc()}')
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })

# Mount static files
app.mount("/", StaticFiles(directory="dist", html = True), name="dist")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=host_port,
        reload=True,
        # ssl_keyfile=ssl_keyfile,
        # ssl_certfile=ssl_certfile
    )