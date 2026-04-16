import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { SessionState } from './types';

ffmpeg.setFfmpegPath(path.join(require('ffmpeg-static'), 'ffmpeg'));

async function convertPcmToMulaw(inputBuffer: Buffer): Promise<string> {
    const tempInput = path.join(os.tmpdir(), `input_${Date.now()}.raw`);
    const tempOutput = path.join(os.tmpdir(), `output_${Date.now()}.ulaw`);

    try {
        fs.writeFileSync(tempInput, inputBuffer);

        await new Promise<void>((resolve, reject) => {
            ffmpeg()
                .input(tempInput)
                .inputFormat('s16le')
                .inputOptions(['-ar 24000', '-ac 1'])
                .output(tempOutput)
                .outputFormat('ulaw')
                .outputOptions(['-ar 8000', '-ac 1'])
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .run();
        });

        const outputBuffer = fs.readFileSync(tempOutput);
        return outputBuffer.toString('base64');
    } finally {
        try {
            fs.unlinkSync(tempInput);
            fs.unlinkSync(tempOutput);
        } catch { }
    }
}

export async function forwardAgentAudioToTwilio(audio: unknown, session: SessionState): Promise<void> {
    let buffer: Buffer | null = null;

    if (Buffer.isBuffer(audio)) buffer = audio;
    else if (audio instanceof ArrayBuffer) buffer = Buffer.from(audio);
    else if (ArrayBuffer.isView(audio)) buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    else if (typeof Blob !== 'undefined' && audio instanceof Blob) buffer = Buffer.from(await audio.arrayBuffer());

    if (!buffer || session.ws?.readyState !== WebSocket.OPEN || !session.streamSid) return;

    const isOpenAISpeak = session.speakProviderType === 'open_ai';
    if (isOpenAISpeak) {
        const base64Mulaw = await convertPcmToMulaw(buffer);
        session.ws.send(JSON.stringify({
            event: 'media',
            streamSid: session.streamSid,
            media: { payload: base64Mulaw }
        }));
        return;
    }

    session.ws.send(JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: { payload: buffer.toString('base64') }
    }));
}