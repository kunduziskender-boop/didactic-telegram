const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execFileAsync = promisify(execFile);

function resolveFfmpegPath() {
  try {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // optional dependency fallback
  }
  return 'ffmpeg';
}

function userDateDir(telegramId, dateKey) {
  return path.join(config.audioRoot, `user_${telegramId}`, dateKey);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pathsForSession(telegramId, dateKey) {
  const dir = userDateDir(telegramId, dateKey);
  ensureDir(dir);
  return {
    dir,
    task: path.join(dir, 'task.mp3'),
    responseOgg: path.join(dir, 'response.ogg'),
    responseWav: path.join(dir, 'response.wav'),
    corrected: path.join(dir, 'corrected.mp3'),
    followUpCorrected: path.join(dir, 'follow_up_corrected.mp3'),
  };
}

function fileLinkToString(link) {
  if (link instanceof URL) return link.href;
  return String(link);
}

async function downloadTelegramFile(telegram, fileId, destPath) {
  const link = await telegram.getFileLink(fileId);
  const fileUrl = fileLinkToString(link);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('Downloaded audio file is empty');
  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, buffer);
  return destPath;
}

async function convertOggToWav(oggPath, wavPath) {
  const ffmpeg = resolveFfmpegPath();
  try {
    await execFileAsync(ffmpeg, [
      '-y', '-i', oggPath, '-ar', '16000', '-ac', '1', wavPath,
    ], { windowsHide: true });
    if (fs.existsSync(wavPath) && fs.statSync(wavPath).size > 0) {
      return wavPath;
    }
  } catch (err) {
    console.warn('ffmpeg conversion failed:', err.message);
  }
  return oggPath;
}

module.exports = {
  pathsForSession,
  downloadTelegramFile,
  convertOggToWav,
  ensureDir,
  resolveFfmpegPath,
};
