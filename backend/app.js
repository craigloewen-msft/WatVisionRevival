const express = require('express');
const app = express();

app.use(express.static(__dirname + "/dist"));

let hostPort = 3000;

if (process.env.NODE_ENV == "production") {
    hostPort = 80;
    console.log("Running as production!");
} else {
    hostPort = process.env.PORT || 3000;
    console.log("Running as development!");
}

const port = hostPort;
app.listen(port, () => console.log('App listening on port ' + port));