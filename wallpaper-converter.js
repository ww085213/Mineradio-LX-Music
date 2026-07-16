'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');

const VIDEO_INPUT_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.m4v', '.gif', '.avi', '.wmv', '.mkv', '.flv', '.apng',
]);

function isFile(filePath) {
  try { return !!filePath && fs.statSync(filePath).isFile(); } catch (_error) { return false; }
}

function execFileAsync(executable, args, options) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout:String(stdout || ''), stderr:String(stderr || '') });
    });
  });
}

class WallpaperConverter {
  constructor(options = {}) {
    this.appDir = path.resolve(options.appDir || __dirname);
    this.cacheDir = path.resolve(options.cacheDir || path.join(this.appDir, '.wallpaper-cache'));
    this.resourcesPath = String(options.resourcesPath || process.resourcesPath || '');
    this.execPath = String(options.execPath || process.execPath || '');
    this.ffmpegPath = this.findFfmpegExecutable();
    this.repkgPath = this.findRePkgExecutable();
    this.previewQueue = Promise.resolve();
    this.previewJobs = new Map();
    this.inspectCache = new Map();
    this.encoderCandidates = this.detectH264Encoders();
  }

  findFfmpegExecutable() {
    const candidates = [
      path.join(this.resourcesPath, 'ffmpeg.exe'),
      path.join(this.resourcesPath, 'bin', 'ffmpeg.exe'),
      path.join(path.dirname(this.execPath), 'ffmpeg.exe'),
      path.join(this.appDir, 'ffmpeg.exe'),
      path.join(this.appDir, 'bin', 'ffmpeg.exe'),
    ];
    const wingetRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    if (wingetRoot && fs.existsSync(wingetRoot)) {
      try {
        for (const packageEntry of fs.readdirSync(wingetRoot, { withFileTypes:true })) {
          if (!packageEntry.isDirectory()) continue;
          const packageDir = path.join(wingetRoot, packageEntry.name);
          if (/^Gyan\.FFmpeg_/i.test(packageEntry.name)) {
            for (const versionEntry of fs.readdirSync(packageDir, { withFileTypes:true })) {
              if (versionEntry.isDirectory()) candidates.push(path.join(packageDir, versionEntry.name, 'bin', 'ffmpeg.exe'));
            }
          }
          if (/^ch\.LosslessCut_/i.test(packageEntry.name)) candidates.push(path.join(packageDir, 'resources', 'ffmpeg.exe'));
        }
      } catch (_error) {}
    }
    for (const candidate of candidates) if (isFile(candidate)) return candidate;
    try {
      return execFileSync('where.exe', ['ffmpeg.exe'], { encoding:'utf8', windowsHide:true, timeout:2500 })
        .split(/\r?\n/).map(value => value.trim()).find(isFile) || '';
    } catch (_error) {
      return '';
    }
  }

  findRePkgExecutable() {
    const candidates = [
      path.join(this.appDir, 'bin', 'repkg', 'RePKG.exe'),
      path.join(this.resourcesPath, 'bin', 'repkg', 'RePKG.exe'),
      path.join(path.dirname(this.execPath), 'resources', 'app', 'bin', 'repkg', 'RePKG.exe'),
    ];
    return candidates.find(isFile) || '';
  }

  detectH264Encoders() {
    const out = ['libx264'];
    if (!this.ffmpegPath) return out;
    try {
      const listing = execFileSync(this.ffmpegPath, ['-hide_banner', '-encoders'], {
        encoding:'utf8', windowsHide:true, timeout:6000, maxBuffer:4 * 1024 * 1024,
      });
      if (/\bh264_nvenc\b/.test(listing)) out.unshift('h264_nvenc');
      if (/\bh264_qsv\b/.test(listing)) out.splice(Math.min(1, out.length), 0, 'h264_qsv');
      if (/\bh264_amf\b/.test(listing)) out.splice(Math.min(2, out.length), 0, 'h264_amf');
    } catch (_error) {}
    return [...new Set(out)];
  }

  capabilities() {
    return {
      ffmpeg:!!this.ffmpegPath,
      repkg:!!this.repkgPath,
      h264Encoders:this.encoderCandidates.slice(),
      outputFormat:'MP4 / H.264 / yuv420p',
      inputFormats:[...VIDEO_INPUT_EXTENSIONS].map(value => value.slice(1)),
    };
  }

  cachePath(sourcePath, label, extension, extra = '') {
    const stat = fs.statSync(sourcePath);
    const key = crypto.createHash('sha1')
      .update(label)
      .update(path.resolve(sourcePath))
      .update(String(stat.size))
      .update(String(stat.mtimeMs))
      .update(String(extra))
      .digest('hex');
    return path.join(this.cacheDir, key + extension);
  }

  async ensureCacheDir() {
    await fs.promises.mkdir(this.cacheDir, { recursive:true });
  }

  encoderArgs(encoder) {
    if (encoder === 'h264_nvenc') return ['-c:v', encoder, '-preset', 'p4', '-cq', '21', '-b:v', '0'];
    if (encoder === 'h264_qsv') return ['-c:v', encoder, '-preset', 'veryfast', '-global_quality', '21'];
    if (encoder === 'h264_amf') return ['-c:v', encoder, '-quality', 'speed', '-qp_i', '20', '-qp_p', '22'];
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19'];
  }

  async encodeMp4(inputPath, outputPath, fps) {
    if (!this.ffmpegPath) throw new Error('FFMPEG_NOT_FOUND');
    await this.ensureCacheDir();
    let lastError = null;
    for (const encoder of this.encoderCandidates) {
      try {
        try { await fs.promises.unlink(outputPath); } catch (_error) {}
        const filters = [];
        if (Number(fps) > 0) filters.push('fps=' + Math.max(1, Math.min(120, Math.round(Number(fps)))));
        filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
        await execFileAsync(this.ffmpegPath, [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', inputPath,
          '-map', '0:v:0', '-an',
          '-vf', filters.join(','),
          ...this.encoderArgs(encoder),
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          outputPath,
        ], { windowsHide:true, timeout:10 * 60 * 1000, maxBuffer:4 * 1024 * 1024 });
        if (!isFile(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('EMPTY_MP4_OUTPUT');
        return { file:outputPath, encoder };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('MP4_ENCODE_FAILED');
  }

  async compatibleMediaFile(filePath, fps = 60) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (!isFile(filePath) || ext === '.mp4' || !VIDEO_INPUT_EXTENSIONS.has(ext)) return filePath;
    const output = this.cachePath(filePath, 'media-mp4-v2', '.mp4', fps);
    if (isFile(output)) return output;
    try {
      await this.encodeMp4(filePath, output, fps);
      return output;
    } catch (error) {
      console.warn('[WallpaperConverter:media]', error.message || error);
      return filePath;
    }
  }

  async staticPreviewFile(filePath) {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (!isFile(filePath) || ext !== '.gif' || !this.ffmpegPath) return filePath;
    const output = this.cachePath(filePath, 'static-preview-v2', '-preview.jpg');
    if (isFile(output)) return output;
    if (!this.previewJobs.has(output)) {
      const job = this.previewQueue.catch(() => {}).then(async () => {
        if (isFile(output)) return output;
        await this.ensureCacheDir();
        const temp = output + '.tmp.jpg';
        try {
          await execFileAsync(this.ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', filePath, '-frames:v', '1',
            '-vf', 'scale=960:-2:force_original_aspect_ratio=decrease',
            '-q:v', '3', temp,
          ], { windowsHide:true, timeout:30000, maxBuffer:1024 * 1024 });
          await fs.promises.rename(temp, output);
          return output;
        } catch (error) {
          try { await fs.promises.unlink(temp); } catch (_error) {}
          console.warn('[WallpaperConverter:preview]', error.message || error);
          return filePath;
        }
      }).finally(() => this.previewJobs.delete(output));
      this.previewJobs.set(output, job);
      this.previewQueue = job;
    }
    return this.previewJobs.get(output);
  }

  async inspectSceneProject(projectFile) {
    if (!isFile(projectFile)) throw new Error('WALLPAPER_PROJECT_NOT_FOUND');
    const projectDir = path.dirname(projectFile);
    const packageFile = path.join(projectDir, 'scene.pkg');
    if (!isFile(packageFile)) return { valid:false, kind:'scene', error:'SCENE_PACKAGE_NOT_FOUND' };
    const stat = fs.statSync(packageFile);
    const cacheKey = packageFile + ':' + stat.size + ':' + stat.mtimeMs;
    if (this.inspectCache.has(cacheKey)) return this.inspectCache.get(cacheKey);
    const base = {
      valid:true,
      kind:'scene',
      packageFile,
      packageSize:stat.size,
      engine:'Wallpaper Engine',
      extractor:this.repkgPath ? 'RePKG v0.4.0-alpha' : '',
      outputFormat:'MP4 / H.264',
    };
    if (!this.repkgPath) {
      const result = { ...base, validated:false, entryCount:0, formats:[] };
      this.inspectCache.set(cacheKey, result);
      return result;
    }
    try {
      const { stdout } = await execFileAsync(this.repkgPath, ['info', packageFile, '-e'], {
        windowsHide:true, timeout:45000, maxBuffer:16 * 1024 * 1024,
      });
      const entries = stdout.split(/\r?\n/).map(line => /^\*\s+(.+?)\s+-\s+\d+\s+bytes\s*$/i.exec(line)).filter(Boolean).map(match => match[1]);
      const formats = [...new Set(entries.map(entry => path.extname(entry).toLowerCase()).filter(Boolean))].sort();
      const result = { ...base, validated:true, entryCount:entries.length, formats };
      this.inspectCache.set(cacheKey, result);
      return result;
    } catch (error) {
      const result = { ...base, valid:false, validated:false, entryCount:0, formats:[], error:'REPKG_INSPECT_FAILED' };
      this.inspectCache.set(cacheKey, result);
      return result;
    }
  }

  async convertRecordingFile(inputPath, options = {}) {
    if (!isFile(inputPath)) throw new Error('WALLPAPER_RECORDING_NOT_FOUND');
    const fps = Math.max(1, Math.min(120, Math.round(Number(options.fps) || 60)));
    const id = String(options.id || 'scene').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'scene';
    await this.ensureCacheDir();
    const output = path.join(this.cacheDir, 'scene-' + id + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.mp4');
    const encoded = await this.encodeMp4(inputPath, output, fps);
    return { ...encoded, fps, mime:'video/mp4', format:'MP4 / H.264' };
  }
}

module.exports = { WallpaperConverter, VIDEO_INPUT_EXTENSIONS };
