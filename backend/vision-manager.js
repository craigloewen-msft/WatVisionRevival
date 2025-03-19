require('dotenv').config();
const sleep = require('util').promisify(setTimeout);
const ComputerVisionClient = require('@azure/cognitiveservices-computervision').ComputerVisionClient;
const ApiKeyCredentials = require('@azure/ms-rest-js').ApiKeyCredentials;
const stream = require('stream');

const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'test_data_video.json');
const rawData = fs.readFileSync(dataPath);
const testData = JSON.parse(rawData);

class VisionManager {
    constructor() {
        this.azureVisionKey = process.env.AZURE_VISION_KEY;
        this.azureVisionEndpoint = process.env.AZURE_VISION_ENDPOINT;

        if (!this.azureVisionKey || !this.azureVisionEndpoint) {
            throw new Error('AZURE_VISION_KEY and AZURE_VISION_ENDPOINT must be set in the environment variables');
        }

        this.computerVisionClient = new ComputerVisionClient(
            new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': this.azureVisionKey } }), this.azureVisionEndpoint);

    }

    async getImageData(inputImage) {
        // Input is a file object with 'mimetype' and 'buffer' properties
        // const arrayBuffer = inputImage.buffer;

        // try {
        //     // Step 2: Use the readInStream method to analyze the image from the buffer stream
        //     let result = await this.computerVisionClient.readInStream(arrayBuffer, {
        //         language: 'en' // specify the language, for example, 'en' for English
        //     });

        //     // Step 3: Process the result as needed
        //     console.log(result);

        //     // For example, getting the operation ID to check results
        //     let operation = result.operationLocation.split('/').slice(-1)[0];

        //     while (result.status !== "succeeded") { await sleep(1000); result = await this.computerVisionClient.getReadResult(operation); }

        //     return result;

        //     console.log(result.analyzeResult);

        // } catch (error) {
        //     console.error('Error analyzing image:', error);
        //     return;
        // }

        return testData;
    }
}

module.exports = VisionManager;