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

// Constants
const SYSTEM_MESSAGE = `You are an AI assistant for Balanced Comfort, a trusted provider of HVAC, plumbing, and water damage restoration services in Fresno, CA. Your goal is to provide clear, empathetic, and efficient customer service while reflecting the company's professional standards and community values. 

When interacting with customers, always use a friendly and professional tone. Begin every conversation by greeting the caller: 'Thank you for calling Balanced Comfort, your trusted service for heating, cooling, plumbing, and water restoration. My name is [Agent Name], how may I assist you today?'

Listen carefully to the customer's issue, show empathy, and aim to guide the conversation towards a solution. Use phrases like 'I understand,' 'That sounds frustrating, let me see how we can resolve this,' and 'Thank you for bringing this to our attention.' 

When discussing services, clearly outline the options without overwhelming the customer with technical jargon unless they request more detail. Provide information about the membership program if relevant: 'We offer a membership that includes annual HVAC and plumbing inspections, priority services, and discounts on repairs.'

Ensure to maintain a respectful, inclusive, and solution-oriented approach throughout the conversation, keeping the customer's comfort as the priority.`;
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

// Root Route
fastify.get('/', async (request, reply) => {
    console.log('Received request on root route');
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Route for Twilio to handle incoming and outgoing calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    console.log('Received incoming call request');
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>Thank you for calling Ballanced Comfort, your trusted service for heating, cooling, plumbing, and water restoration.</Say>
                              <Pause length="1"/>
                              <Say>My name is Kai, how may I assist you today?</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;
    console.log('Sending TwiML response:', twimlResponse);
    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected to WebSocket');
        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
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
                    turn_detection: { 
                        type: 'server_vad',
                        threshold: 0.50,
                        prefix_padding: 300,
                        silence_duration: 500
                    },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ["text", "audio"],
                    temperature: 0.8,
                    max_tokens: 512, // Set max_tokens to 512
                }
            };
            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            console.log('Scheduling session update...');
            setTimeout(() => {
                console.log('Executing scheduled session update...');
                sendSessionUpdate();
            }, 250);
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
                    console.log('Sending audio delta to Twilio');
                    connection.send(JSON.stringify(audioDelta));
                }
                if (response.type === 'rate_limits.updated') {
                    console.log('Rate limits updated:', response);
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        openAiWs.on('message', (data) => {
            console.log('Received message from OpenAI:', data.toString());
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
                    console.log('Sending audio delta to Twilio');
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
                console.log('Received message from Twilio:', data.event);
                if (data.event === 'media') {
                    console.log('Received audio data from Twilio');
                }
                switch (data.event) {
                    case 'media':
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            console.log('Sending audio buffer to OpenAI');
                            openAiWs.send(JSON.stringify(audioAppend));
                        } else {
                            console.warn('OpenAI WebSocket not open, cannot send audio buffer');
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
            console.log('Client disconnected from WebSocket');
            if (openAiWs.readyState === WebSocket.OPEN) {
                console.log('Closing OpenAI WebSocket');
                openAiWs.close();
            }
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', (code, reason) => {
            console.log(`Disconnected from the OpenAI Realtime API. Code: ${code}, Reason: ${reason}`);
        });
        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
            if (error.message) console.error('Error message:', error.message);
            if (error.code) console.error('Error code:', error.code);
        });
    });
});

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error('Error starting server:', err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});
