We're so excited for our friends at OpenAI, who launched their Realtime API today. The API opens up Speech to Speech (S2S) capabilities for their GPT-4o multimodal model, which supports direct audio input and output – avoiding translating back and forth from text with a speech-to-text (SST) or text-to-speech (TTS) step.

What does that mean for you? S2S models improve latency – OpenAI's Realtime API unlocks fluid conversations that feel like real human dialog... as I'm sure you'll agree. That's why we're thrilled to provide this launch integration in collaboration with OpenAI.

In this tutorial, I’ll show you how to build an AI voice assistant using Twilio Voice and the OpenAI Realtime API, powered by Node.js. Once you build the tool, you’ll be able to talk to your assistant just as you would a human, and ask it for facts (or jokes!). Together, we’ll set up a Twilio Media Stream server to receive audio from a phone call, process it using the OpenAI Realtime API, and pass the AI’s response back to Twilio to keep the conversation going.

Buckle up – let's get started!

This app is also available as a prebuilt application on Code Exchange. You can find it here.
Prerequisites
To follow along with this tutorial, you will first need:

Node.js 18+ (I used 18.20.4 for this tutorial; you can download it from here)
A Twilio account. If you don’t have one yet, you can sign up for a free trial here.
A Twilio number with Voice capabilities. Here are instructions to purchase a phone number.
An OpenAI account and an OpenAI API Key. You can sign up here.
OpenAI Realtime API access. Check here for more information.
(Optional) ngrok or another tunneling solution to expose your local server to the internet for testing. Download ngrok here.
A cell phone or landline that can make outgoing phone calls.
And with that, you can start the build!

Set up the Realtime API speech-to-speech Node project
In these next steps, I’ll walk you through setting up your project, installing dependencies, and writing the code you’ll need to proxy websocket connections between Twilio and OpenAI.

Alternatively, you can find our repository here. We also have a video version of this tutorial you can find here:


Alright, let’s get started for real!

Step 1: Initialize the Project
First, set up a new Node.js project:

Bash

Copy code
mkdir speech-assistant-openai-realtime-api-node
cd speech-assistant-openai-realtime-api-node
npm init -y; npm pkg set type="module";
Step 2: Install dependencies

Next, install the required dependencies for the project. We’ll be using the web framework Fastify, and we’ll need websocket support. We’ll also be storing our sensitive environment variable in a .env file.

Bash

Copy code
npm install fastify ws dotenv @fastify/formbody @fastify/websocket
Step 3: Create the project files
We will create a file named index.js for our main code. We’ll also have that .env file to store environment variables. You can find more information on this strategy here.

In this case, you’ll only need your OpenAI API key in the .env – double check it has Realtime API access.

Step 3.1: Create the .env File
First, create the .env file:

Bash

Copy code
touch .env
Then – in your favorite text editor – add your OPENAI_API_KEY on the first line:

Text

Copy code
OPENAI_API_KEY="your_openai_api_key_here"
S tep 3.2: Create the index.js File

Next, create a new file called index.js in your project directory:

Bash

Copy code
touch index.js
Step 4: Write the server code
Great stuff – now we’re ready to get down to the tutorial. I’ll break down the index.js code into multiple steps and provide explanations for each part – but feel free to switch over to the Code Exchange app or the repo if you’d like to fast forward!

Step 4.1: Import dependencies, load our Environment Variable, and initialize Fastify
There’s nothing out of the ordinary here – we start by importing required modules, setting up the path resolution, and loading the environment variables from our .env file.

Paste the following code in your index.js:

JavaScript

Copy code
import Fastify from 'fastify';
import WebSocket from 'ws';
import fs from 'fs';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
// Load environment variables from .env file
dotenv.config();
// Retrieve the OpenAI API key from environment variables. You must have OpenAI Realtime API access.
const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}
// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
Step 4.2: Define some constants
Next, we define constants for the system message, voice, and server port. We’ll also choose the OpenAI events to log to the console.

Here’s what you should paste next in your file:

JavaScript

Copy code
// Constants
const SYSTEM_MESSAGE = 'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.';
const VOICE = 'alloy';
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment
// List of Event Types to log to the console. See OpenAI Realtime API Documentation. (session.updated is handled separately.)
const LOG_EVENT_TYPES = [
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created'
];
Here, the SYSTEM_MESSAGE sets the tone and behavior for the AI during the conversation, which we will eventually pass as instructions to OpenAI. By customizing this message, you can control the AI's personality and interaction style. In a few sections, you'll see how we pass it to OpenAI to influence our conversation.

The VOICE constant controls how the AI will sound. At launch, you can choose alloy (like I have here), echo, or shimmer.

The PORT constant controls which port your application will open. We'll discuss this more in the ngrok section below.

Finally, LOG_EVENT_TYPES are the types of events from OpenAI we’ll display on the command line. You can find the whole list in OpenAI’s Realtime API documentation.

Step 4.3: Define two routes
Now, we get down to the heart of the code! We define a root route (primarily a health check…) and a route to handle incoming calls. The /incoming-call will return TwiML, Twilio’s Markup Language, to direct Twilio how to handle the call – more on that in a second.

Paste this into index.js after we set the constant list for LOG_EVENT_TYPES:

JavaScript

Copy code
// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});
// Route for Twilio to handle incoming and outgoing calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>Please wait while we connect your call to the A. I. voice assistant, powered by Twilio and the Open-A.I. Realtime API</Say>
                              <Pause length="1"/>
                              <Say>O.K. you can start talking!</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;
    reply.type('text/xml').send(twimlResponse);
});
As with all TwiML, we start with the XML version and open a <Response> tag. We then have Twilio say a brief message to the caller – have fun with it! –, pause for 2 seconds, then ask the caller to start talking.

The <Connect> verb works together with the <Stream> noun to open a bidirectional stream using Twilio’s Media Streams. This is where the magic of the demo happens – in the next step, I will show you how we’ll proxy audio between two websockets.

Step 4.4: Handle WebSocket connections
Now we need to set up the WebSocket route for media streaming (the route we give Twilio in the above section), and set up websockets with Twilio and OpenAI. This code is a bit long, but I’ll explain what’s happening right after the code block.

Paste this code below where we defined the routes:

JavaScript

Copy code
// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');
        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1"
            }
        });
        let streamSid = null;
        const sendSessionUpdate = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                }
            };
            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };
        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(sendSessionUpdate, 250); // Ensure connection stability, send after .25 seconds
        });
        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`Received event: ${response.type}`, response);
                }
                if (response.type === 'session.updated') {
                    console.log('Session updated successfully:', response);
                }
                if (response.type === 'response.audio.delta' && response.delta) {
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
                    };
                    connection.send(JSON.stringify(audioDelta));
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });
        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                switch (data.event) {
                    case 'media':
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Incoming stream has started', streamSid);
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });
        // Handle connection close
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            console.log('Client disconnected.');
        });
        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
        });
        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
        });
    });
});
As you can see, first we set up a WebSocket route (/media-stream) to handle media streaming between Twilio and OpenAI. This is the route we referenced in our TwiML, above. The next two areas require more explanation.

Set up the OpenAI Realtime API Session and Conversation
Next, we set up our Session configuration with OpenAI. This configuration is sent to the OpenAI WebSocket as a JSON object after the connection opens, after a slight delay. We use the sendSessionUpdate() function to define how the AI interacts and responds. You can read more about the options I chose in the OpenAI Realtime API documentation.

The sendSessionUpdate function also configures the OpenAI session attributes:

turn_detection: Enables server-side Voice Activity Detection (VAD).
input_audio_format / output_audio_format: Specifies audio formats, which we changed to g711_ulaw due to Twilio requirements.
voice: Sets the AI voice to 'alloy' (or however you set the constant).
instructions: Influences AI interaction using SYSTEM_MESSAGE.
modalities: Enables both text and audio communication.
temperature: Controls randomness in AI responses.
Proxy between the Twilio and OpenAI WebSockets
The following lines proxy audio data (using Twilio-supported G.711 u-law format) between the Twilio Media Stream and OpenAI Realtime AI WebSocket connections. When the call starts, this is where the caller's voice is processed, and the AI-generated audio is streamed back.

Here's a detailed walkthrough of how we are proxying between OpenAI Realtime and Twilio:

start event: Captures the stream's unique ID (streamSid).
media event: media event: Processes and forwards audio data payloads from the ongoing call to OpenAI.
response.audio.delta: Handles AI-generated audio data from OpenAI, re-encodes it, and sends it to Twilio.
Twilio WebSocket close event: Handles client disconnection and closes streams.
Step 4.5: Prepare the server
And finally, we start the Fastify server and bring it home (using the port we passed in or defined). Paste this below what you have, and we’re ready to roll!

JavaScript

Copy code
fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});
Run the server

Exit back out of the file.

You can now run the server with the following command:

Bash

Copy code
node index.js
If the server starts successfully, you should see the message Server is listening on port 5050 (or the port you specified) in your terminal.

Finish your setup
Now it’s time to provide instructions to Twilio and finish the wiring! We’ll cover using the reverse proxy ngrok to make your server public.

Step 5: Expose your server to Twilio using ngrok
Now, you need to use ngrok or a similar service (or a virtual private server, etc.) to expose your local server to the public internet. Twilio requires a public URL to send requests to your server and receive instructions from you.

I’ll provide instructions for ngrok in this post. You can find other reverse proxy or tunneling options here, and some notes on further options here.
Download and install ngrok if you still need to, then run the following command. If you have changed the port from 5050, be sure to update it here:

Bash

Copy code
ngrok http 5050
This will give you a public URL (e.g., https://abc123.ngrok.io) that you can use for testing. Here’s how it looked for me:


Step 6: Configure Twilio
We’re so close now, can you feel it?

Go to the Twilio Console and select your Voice-enabled number.

Under Voice & Fax, set the A CALL COMES IN webhook to your ngrok URL (in the Forwarding line, ( https://ad745c4093d9.ngrok.app in my screenshot) appending /incoming-call. For example, in my case, https://ad745c4093d9.ngrok.app/incoming-call.


Save your changes - you’re at the final step!

Test your setup!
Make sure your ngrok session is still running and your server is up. If it is, it’s time – you can now make a call to your Twilio number using a cell phone or landline.

The server should handle the call (providing your TwiML to Twilio), then proxy the OpenAI Realtime API and Twilio WebSockets together. Start talking – you should now hear the AI-based system message and be able to interact with it!

Session lengths are limited to 15 minutes during the OpenAI Realtime API beta.
Common Issues and Troubleshooting
If your setup isn’t working (but your server is running), there are a few places to check first:

Is ngrok running? Is the URL properly set in the Voice Configuration -> A Call Comes In section?
Was there an error with Twilio, possibly in your TwiML? You can debug Twilio errors in a few ways - there’s more info in this article.
Is your code calling OpenAI correctly? See more information in their documentation.
