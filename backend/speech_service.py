import os
from dotenv import load_dotenv
import wave
import time
from openai import AsyncAzureOpenAI
from openai.resources.beta.realtime.realtime import AsyncRealtimeConnection
import asyncio
import base64
import aiohttp
import websockets
import json
from websockets import ClientConnection

class ContinuousSpeechService:
    def __init__(self, socketio, session_id: str):
        self.socketio = socketio
        self.session_info = None

        self.session_id = session_id

        self.debug_audio_file = None
        self.debug_recording = True  # Set to False to disable recording

        realtime_endpoint = os.getenv('AZURE_REALTIME_OPENAI_ENDPOINT')
        realtime_key = os.getenv('AZURE_REALTIME_OPENAI_KEY')
        deployment_name = "gpt-4o-realtime-preview"
        api_version = "2025-04-01-preview"
        self.ws_uri = f"wss://{realtime_endpoint}/openai/realtime?api-version={api_version}&deployment={deployment_name}&api-key={realtime_key}"

        if not realtime_endpoint or not realtime_key:
            raise ValueError("Azure Realtime OpenAI endpoint and key must be set in environment variables.")

        self.websocket: ClientConnection = None
        self.is_running = False
        self._event_task = None
    
    async def start_recognition(self):
        """Start continuous recognition for a session"""

        self.is_running = True
        
        # Start event processing task
        self._event_task = asyncio.create_task(self._process_events())

        if self.debug_recording:
            timestamp = int(time.time())
            debug_filename = f"debug_audio_{self.session_id}_{timestamp}.wav"
            self.debug_audio_file = wave.open(debug_filename, 'wb')
            self.debug_audio_file.setnchannels(1)  # Mono
            self.debug_audio_file.setsampwidth(2)  # 16-bit = 2 bytes
            self.debug_audio_file.setframerate(24000)  # 16kHz
            print(f"Debug: Recording audio to {debug_filename}")
        
        await self._event_task
        return True
    
    async def stop_recognition(self):
        """Stop recognition and clean up"""
        self.is_running = False

        # if self.connection:
        #     print("Commmitting audio buffer")
        #     await self.connection.input_audio_buffer.commit()

        # if self._event_task:
        #     try: 
        #         self._event_task.cancel()
        #     except asyncio.CancelledError:
        #         print("Event processing task cancelled")

        # if self.connection_manager:
        #     await self.connection_manager.__aexit__(None, None, None)

        # # Close debug audio file
        # if self.debug_recording and self.debug_audio_file:
        #     self.debug_audio_file.close()
        #     print("Debug: Audio file saved and closed")

        self.socketio.emit('session_stopped', {
            'session_id': self.session_id,
        }, room=self.session_id)

        if self.websocket:
            self.websocket = None

    async def _process_events(self):
        """Process events from the realtime connection"""

        print("Debug: Starting event processing loop")

        async with websockets.connect(self.ws_uri) as websocket:
            self.websocket = websocket
            
            session_config = {
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    # "instructions": "You are a helpful assistant. Please analyze and respond to the audio input.",
                    # "voice": "alloy",
                    # "input_audio_format": "pcm16",
                    # "output_audio_format": "pcm16"
                }
            }
            await websocket.send(json.dumps(session_config))

            user_message = {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Hey there!",
                        }
                    ]
                }
            }
            await websocket.send(json.dumps(user_message))

            # Request response
            response_request = {
                "type": "response.create",
                "response": {
                    "modalities": ["text", "audio"]
                }
            }
            await websocket.send(json.dumps(response_request))

            self.socketio.emit('session_started', {
                'session_id': self.session_id,
            }, room=self.session_id)

            async for message in websocket:
                event = json.loads(message)
                event_type = event.get("type", "")
                print("Debug: Received event:", event_type)
                if not self.is_running:
                    break
                    
                if event_type == "response.audio_transcript.delta":
                    self.socketio.emit('response.audio_transcript.delta', {
                        'session_id': self.session_id,
                        'delta': event.get('delta', ''),
                    }, room=self.session_id)
                elif event_type == "response.audio.delta":
                    self.socketio.emit('response.audio.delta', {
                        'session_id': self.session_id,
                        'delta': event.get('delta', ''),
                    }, room=self.session_id)
                elif event_type == "error":
                    print("===RECEIVED ERROR from OpenAI realtime service===")
                    print(event)
                    await self.stop_recognition()
                else:
                    print(f"Unhandled event type: {event_type}")
                    self.socketio.emit(event_type, {
                        'event_data': 1,
                    }, room=self.session_id)

        print("Debug: Event processing loop ended")

        if self.websocket:
            self.websocket = None
    
    async def process_audio_chunk(self, audio_data):
        """Process incoming audio chunk"""

        # Check if audio_data is bytes and convert to base64
        if isinstance(audio_data, bytes):
            audio_data_b64 = base64.b64encode(audio_data).decode('utf-8')
        elif isinstance(audio_data, str):
            # Assume it's already base64 encoded
            audio_data_b64 = audio_data
            print("Debug: Audio data is already a string (assuming base64)")
        else:
            print(f"Debug: Unexpected audio_data type: {type(audio_data)}")
            return

        if self.websocket:
            input_audio_message = {
                "type": "input_audio_buffer.append",
                "audio": audio_data_b64
            }
            await self.websocket.send(json.dumps(input_audio_message))
            
        # Also record to debug file if enabled
        if self.debug_recording and self.debug_audio_file and isinstance(audio_data, bytes):
            self.debug_audio_file.writeframes(audio_data)
