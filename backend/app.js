require('dotenv').config();
const VisionManager = require('./vision-manager');
const multer = require("multer");
const upload = multer(); // Memory storage (stores file in req.file)

const express = require('express');
const app = express();

app.use(express.static(__dirname + "/dist"));

let hostPort;

if (process.env.NODE_ENV == "production") {
    hostPort = process.env.PORT || 3000;
    console.log("Running as production!");
} else {
    hostPort = process.env.PORT || 8080;
    console.log("Running as development!");
}

const port = hostPort;
app.listen(port, () => console.log('App listening on port ' + port));

const visionManager = new VisionManager();

async function tryCatchResult(res, inputFunction) {
    try {
        let result = await inputFunction();
        res.json({ success: true, result: result });
    } catch (error) {
        console.error('Error:', error);
        res.json({ success: false, error: error });
    }
}

app.post('/api/vision', upload.single("image"), async (req, res) => {
    tryCatchResult(res, async () => visionManager.getImageData(req.file));
});