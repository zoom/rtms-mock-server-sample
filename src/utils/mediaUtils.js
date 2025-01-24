
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '../../data');
const PCM_DIR = path.join(__dirname, '../../data');

const initializePCMConversion = (callback) => {
    const files = fs
        .readdirSync(DATA_DIR)
        .filter((file) => file.endsWith(".m4a") || file.endsWith(".mp4"));

    let remaining = files.length;
    if (remaining === 0) {
        callback();
        return;
    }

    files.forEach((file) => {
        const inputFile = path.join(DATA_DIR, file);
        const outputFile = path.join(PCM_DIR, `${path.parse(file).name}.pcm`);
        convertToPCM(inputFile, outputFile, (error) => {
            if (--remaining === 0) {
                callback();
            }
        });
    });
};

const convertToPCM = (inputFile, outputFile, callback) => {
    const command = `ffmpeg -y -i "${inputFile}" -f s16le -acodec pcm_s16le -ar 44100 -ac 2 "${outputFile}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error converting file ${inputFile}:`, error);
        } else {
            console.log(`Converted ${inputFile} to ${outputFile}`);
        }
        callback(error);
    });
};

module.exports = { initializePCMConversion };
