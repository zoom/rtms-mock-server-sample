
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Add all media-related utility functions from the original file
function convertToPCM(inputFile, outputFile, callback) {
    const command = `ffmpeg -y -i "${inputFile}" -f s16le -acodec pcm_s16le -ar 44100 -ac 2 "${outputFile}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error converting file ${inputFile}:`, error);
        } else {
            console.log(`Converted ${inputFile} to ${outputFile}`);
        }
        callback(error);
    });
}

// Add other utility functions...

module.exports = {
    convertToPCM,
    // Export other utility functions
};
