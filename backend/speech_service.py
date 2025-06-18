from __future__ import annotations
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
from typing import TYPE_CHECKING

from fastapi import WebSocket

if TYPE_CHECKING:
    from vision_instance import VisionInstance

class ContinuousSpeechService:
    def __init__(self, main_websocket: WebSocket, session_id: str, parent_vision_instance: "VisionInstance"):
        self.main_websocket = main_websocket
        self.session_info = None

        self.session_id = session_id

        self.debug_audio_file = None
        self.debug_recording = False  # Set to False to disable recording

        self.parent_vision_instance = parent_vision_instance

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

        self.tokenUsageCount = 0

        self.start_touch_screen_function_call_id = None
    
    async def start_session(self):
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
        
        # await self._event_task
        return True
    
    async def stop_session(self):
        """Stop recognition and clean up"""
        self.is_running = False

        if self._event_task:
            try: 
                self._event_task.cancel()
            except asyncio.CancelledError:
                print("Event processing task cancelled")

        # if self.connection_manager:
        #     await self.connection_manager.__aexit__(None, None, None)

        # Close debug audio file
        # if self.debug_recording and self.debug_audio_file:
        #     self.debug_audio_file.close()
        #     print("Debug: Audio file saved and closed")

        print(f"Session {self.session_id} ending. Total tokens used: {self.tokenUsageCount}")


    async def _process_events(self):
        """Process events from the realtime connection"""

        print("Debug: Starting event processing loop")

        async with websockets.connect(self.ws_uri) as websocket:
            self.websocket = websocket
            
            session_config = {
                "type": "session.update",
                "session": {
                    "tools": [
                        {
                            "type": "function",
                            "name": "get_description_of_touchscreen",
                            "description": "Get information about the touch screen in front of the user.",
                            "parameters": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                        {
                            "type": "function",
                            "name": "start_tracking_touchscreen",
                            "description": "Start touch screen processing. The user's hand must be away from the screen when started.",
                            "parameters": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                        {
                            "type": "function",
                            "name": "stop_tracking_touchscreen",
                            "description": "Stop identifying the touch screen.",
                            "parameters": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                    ],
                    "modalities": ["text", "audio"],
                    "instructions": """You are a helpful assistant whose goal is to help the user understand the touch screen infront of them.
The user is blind or visually impaired.

You have some functions available to you, use them as needed to help the user.
When you are 'tracking the touch screen', the system will take a snapshot of the touch screen and then as the user moves their hand over the screen you will get events of what their hand is hovering over.

When starting say hello and ask the user to to tell you when they are ready to start tracking the touch screen.""",
                    "tool_choice": "auto",
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
                            "text": "Hey there! Can you help me understand this touch screen in front of me?",
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

            await self.main_websocket.send_json({
                "type": "session_started"
            })

            async for message in websocket:
                event = json.loads(message)
                event_type = event.get("type", "")
                if not self.is_running:
                    break

                print(f"Debug: Received event of type {event_type}")
                    
                if event_type == "response.audio_transcript.delta":
                    await self.main_websocket.send_json({
                        "type": "response.audio_transcript.delta",
                        "event": event
                    })
                elif event_type == "response.audio.delta":
                    await self.main_websocket.send_json({
                        "type": "response.audio.delta",
                        "event": event
                    })
                elif event_type == "response.done":
                    usage = event.get('response', {}).get('usage', {})

                    if usage: 
                        self.tokenUsageCount += usage.get('total_tokens', 0)
                        print(f"Debug: Total tokens used: {self.tokenUsageCount}")

                    function_calls = event.get('response', {}).get('output', [])

                    for call in function_calls:
                        if call.get('type') == 'function_call':
                            await self.__process_function_call(call)

                    await self.main_websocket.send_json({
                        "type": "response.done",
                        "event": event
                    })
                elif event_type == "error":
                    print("===RECEIVED ERROR from OpenAI realtime service===")
                    print(event)
                    await self.main_websocket.send_json({
                        "type": "error",
                        "event": event
                    })
                    await self.stop_session()

        print("Debug: Event processing loop ended")

        if self.websocket:
            self.websocket = None
    
    async def __process_function_call(self, function_call):
        """Process a function call from the response"""
        function_name = function_call.get('name')
        function_args = function_call.get('arguments', {})

        print(f"Debug: Processing function call: {function_name} with args: {function_args}")

        function_output = ""
        
        if function_name == "start_tracking_touchscreen":
            await self.main_websocket.send_json({
                "type": "start_tracking_touchscreen",
            })
            self.start_touch_screen_function_call_id = function_call.get('call_id')
        elif function_name == "stop_tracking_touchscreen":
            await self.main_websocket.send_json({
                "type": "stop_tracking_touchscreen",
            })
            function_output = "Stopped tracking touch screen."
        elif function_name == "get_description_of_touchscreen":
            function_output = self.parent_vision_instance.get_current_image_description()

        if function_output != "":
            function_response = {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": function_call.get('call_id'),
                    "output": "{\"result\": \"" + function_output + "\"}"
                }
            }
            await self.websocket.send(json.dumps(function_response))

            response_request = {
                "type": "response.create",
                "response": {
                    "modalities": ["text", "audio"]
                }
            }
            await self.websocket.send(json.dumps(response_request))
    
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

    async def finalize_start_touching_touchscreen(self):
        if self.start_touch_screen_function_call_id:
            function_response = {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": self.start_touch_screen_function_call_id,
                    "output": "{\"result\": \"" + "Touch screen recognition started and is ready for the user." + "\"}"
                }
            }
            await self.websocket.send(json.dumps(function_response))

            response_request = {
                "type": "response.create",
                "response": {
                    "modalities": ["text", "audio"]
                }
            }
            await self.websocket.send(json.dumps(response_request))