/**
 * Export utilities — PNG save and WebM video recording.
 * Uses the File System Access API (showSaveFilePicker) when available for
 * reliable filenames on macOS. Falls back to link-click for other browsers.
 */

let mediaRecorder = null;
let recordedChunks = [];

/**
 * Save a blob/file with a proper filename.
 * Tries showSaveFilePicker first (native OS dialog), falls back to link-click.
 */
async function saveFile(blob, filename, description, acceptExt, mimeType) {
    // ——— Primary: File System Access API (Chrome / Edge on macOS) ———
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description,
                    accept: { [mimeType]: [acceptExt] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;                       // success — done
        } catch (e) {
            if (e.name === 'AbortError') return;   // user cancelled
            console.warn('showSaveFilePicker failed, using fallback:', e);
        }
    }

    // ——— Fallback: invisible <a> click ———
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 3000);
}

export async function savePNG(canvas) {
    const filename = `fractal-${Date.now()}.png`;

    // Get a proper Blob instead of a data-URL for showSaveFilePicker compat
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await saveFile(blob, filename, 'PNG Image', '.png', 'image/png');
}

export function startRecording(canvas, onStop, audioStream) {
    const stream = canvas.captureStream(30);

    // Merge audio tracks if available
    if (audioStream) {
        for (const track of audioStream.getAudioTracks()) {
            stream.addTrack(track);
        }
    }

    const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];

    let selectedMimeType = '';
    for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            break;
        }
    }

    if (!selectedMimeType) {
        console.error('No supported MediaRecorder MIME type found.');
        alert('Your browser does not support video recording.');
        if (onStop) onStop();
        return null;
    }

    console.log(`Using MIME type: ${selectedMimeType}`);

    mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 8_000_000,
    });

    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        const ext = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const mime = mediaRecorder.mimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
        const filename = `fractal-${Date.now()}.${ext}`;
        const blob = new Blob(recordedChunks, { type: mime });

        await saveFile(blob, filename, 'Video', `.${ext}`, mime);
        if (onStop) onStop();
    };

    mediaRecorder.start();
    return mediaRecorder;
}

export function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

export function isRecording() {
    return mediaRecorder && mediaRecorder.state === 'recording';
}
