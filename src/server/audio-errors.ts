type AudioStep = 'YouTube download' | 'Audio inspection' | 'Audio conversion' | 'Audio storage';

// Only controlled descriptions reach job logs. Tool stderr may contain source names,
// temporary paths, signed URLs, or credentials and must never be returned verbatim.
export class AudioProcessingError extends Error {}

export async function audioStep<T>(step: AudioStep, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AudioProcessingError) throw error;
    const failure = error as { code?: string; killed?: boolean; stderr?: string } | null;
    let reason = 'Check the input, tool installation, and service availability.';
    if (failure?.code === 'ENOENT') {
      const tool =
        step === 'YouTube download' ? 'yt-dlp' : step === 'Audio inspection' ? 'ffprobe' : 'ffmpeg';
      reason =
        step === 'Audio storage'
          ? 'A required local file is missing.'
          : `${tool} was not found. Check its executable path and restart the terminal.`;
    } else if (failure?.killed || failure?.code === 'ETIMEDOUT') {
      reason = 'The operation timed out. Try again or use another source.';
    } else if (step === 'YouTube download') {
      const stderr = typeof failure?.stderr === 'string' ? failure.stderr : '';
      if (
        /ffmpeg-location .*does not exist|ffmpeg (?:is not installed|not found)|ffprobe and ffmpeg not found/i.test(
          stderr,
        )
      )
        reason = 'FFmpeg was not found by yt-dlp. Check FFMPEG_PATH or the terminal PATH.';
      else if (/sign in to confirm|not a bot|HTTP Error (?:403|429)/i.test(stderr))
        reason = 'YouTube blocked this request. Try another recording or upload an audio file.';
      else if (
        /private video|video unavailable|not available|has been removed|age.restricted/i.test(
          stderr,
        )
      )
        reason = 'This recording is unavailable or restricted. Choose another recording.';
      else if (/requested format is not available|no video formats found/i.test(stderr))
        reason = 'No downloadable format was found. Update yt-dlp or choose another recording.';
    }
    throw new AudioProcessingError(`${step} failed. ${reason}`);
  }
}

export function audioFailureMessage(error: unknown): string {
  return error instanceof AudioProcessingError
    ? error.message
    : 'Audio processing failed. Check the selected range, source availability, and FFmpeg/yt-dlp installation.';
}
