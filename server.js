const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Force Socket.io to use websocket transport first to avoid Render polling 502 gateway errors
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

let waitingQueue = [];

function isPlatformOpen() {
    return true; // Keep open for testing
}

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HavenCraft Chat</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { font-family: Arial, sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e1e1e; padding: 25px; border-radius: 10px; width: 350px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
            input, select, button { width: 100%; padding: 10px; margin-top: 10px; border-radius: 5px; border: none; box-sizing: border-box; }
            button { background: #6200ee; color: white; cursor: pointer; font-weight: bold; }
            button:hover { background: #7c4dff; }
            .hidden { display: none !important; }
            #chat-box { height: 250px; border: 1px solid #333; overflow-y: scroll; padding: 10px; margin-bottom: 10px; background: #181818; }
            .message { margin-bottom: 8px; }
            .timer { color: #ff5252; font-weight: bold; text-align: center; margin-bottom: 10px; }
        </style>
    </head>
    <body>

        <div class="card" id="setup-screen">
            <h2>HavenCraft Chat</h2>
            <div id="error" style="color: #ff5252; font-size: 14px;"></div>
            <input type="text" id="nickname" placeholder="Enter your nickname..." maxlength="15">
            <label>I am a:</label>
            <select id="gender">
                <option value="male">Boy</option>
                <option value="female">Woman</option>
            </select>
            <label>Looking for:</label>
            <select id="lookingFor">
                <option value="female">Woman</option>
                <option value="male">Boy</option>
            </select>
            <button onclick="startMatching()">Find Stranger</button>
        </div>

        <div class="card hidden" id="waiting-screen">
            <h3>Searching...</h3>
            <p>Looking for an available match based on your preferences...</p>
        </div>

        <div class="card hidden" id="chat-screen" style="width: 450px;">
            <div class="timer" id="timer-display">Time Left: 35:00</div>
            <div id="chat-box"></div>
            <input type="text" id="message-input" placeholder="Type a message..." onkeypress="checkEnter(event)">
            <button onclick="sendMessage()">Send</button>
        </div>

        <script>
            // Force client to connect cleanly
            const socket = io({ transports: ['websocket', 'polling'] });
            let currentRoom = null;
            let countdownInterval = null;

            function startMatching() {
                const nickname = document.getElementById('nickname').value.trim();
                const gender = document.getElementById('gender').value;
                const lookingFor = document.getElementById('lookingFor').value;

                if (!nickname) {
                    document.getElementById('error').innerText = 'Please enter a nickname.';
                    return;
                }

                document.getElementById('setup-screen').classList.add('hidden');
                document.getElementById('waiting-screen').classList.remove('hidden');

                socket.emit('join-queue', { nickname, gender, lookingFor });
            }

            socket.on('waiting', (msg) => {});

            socket.on('error-msg', (msg) => {
                alert(msg);
                location.reload();
            });

            socket.on('chat-matched', (data) => {
                currentRoom = data.roomId;
                document.getElementById('waiting-screen').classList.add('hidden');
                document.getElementById('chat-screen').classList.remove('hidden');
                appendSystemMessage(\`Connected to \${data.partnerNickname}! Say hello.\`);
                startTimer(35 * 60);
            });

            function sendMessage() {
                const input = document.getElementById('message-input');
                const message = input.value.trim();
                if (!message || !currentRoom) return;

                appendMessage('You', message);
                socket.emit('send-message', { roomId: currentRoom, message });
                input.value = '';
            }

            socket.on('receive-message', (data) => {
                appendMessage(data.sender, data.message);
            });

            socket.on('chat-ended', (data) => {
                alert('Chat ended: ' + data.reason);
                location.reload();
            });

            function appendMessage(sender, text) {
                const box = document.getElementById('chat-box');
                box.innerHTML += \`<div class="message"><strong>\${sender}:</strong> \${text}</div>\`;
                box.scrollTop = box.scrollHeight;
            }

            function appendSystemMessage(text) {
                const box = document.getElementById('chat-box');
                box.innerHTML += \`<div class="message" style="color: #00e676; text-align:center;"><em>\${text}</em></div>\`;
                box.scrollTop = box.scrollHeight;
            }

            function checkEnter(e) {
                if (e.key === 'Enter') sendMessage();
            }

            function startTimer(durationInSeconds) {
                let timer = durationInSeconds;
                const display = document.getElementById('timer-display');
                
                countdownInterval = setInterval(() => {
                    let minutes = parseInt(timer / 60, 10);
                    let seconds = parseInt(timer % 60, 10);

                    minutes = minutes < 10 ? "0" + minutes : minutes;
                    seconds = seconds < 10 ? "0" + seconds : seconds;

                    display.innerText = \`Time Left: \${minutes}:\${seconds}\`;

                    if (--timer < 0) {
                        clearInterval(countdownInterval);
                    }
                }, 1000);
            }
        </script>
    </body>
    </html>
    `);
});

io.on('connection', (socket) => {
    socket.on('join-queue', (data) => {
        if (!isPlatformOpen()) {
            socket.emit('error-msg', 'Platform is closed!');
            return;
        }

        socket.userData = data;

        const matchIndex = waitingQueue.findIndex(
            user => user.gender === data.lookingFor && user.lookingFor === data.gender
        );

        if (matchIndex !== -1) {
            const partner = waitingQueue.splice(matchIndex, 1)[0];
            const roomId = `room_${socket.id}_${partner.id}`;

            socket.join(roomId);
            const partnerSocket = io.sockets.sockets.get(partner.id);

            if (partnerSocket) {
                partnerSocket.join(roomId);

                io.to(roomId).emit('chat-matched', {
                    roomId,
                    myNickname: socket.userData.nickname,
                    partnerNickname: partner.userData.nickname
                });

                const timerMinutes = 35 * 60 * 1000;
                const roomTimeout = setTimeout(() => {
                    io.to(roomId).emit('chat-ended', { reason: '35 minutes time limit reached.' });
                    io.in(roomId).socketsLeave(roomId);
                }, timerMinutes);

                socket.roomTimeout = roomTimeout;
                partnerSocket.roomTimeout = roomTimeout;
            }
        } else {
            waitingQueue.push({ id: socket.id, ...data });
            socket.emit('waiting', 'Looking for a stranger...');
        }
    });

    socket.on('send-message', (data) => {
        socket.to(data.roomId).emit('receive-message', {
            sender: socket.userData.nickname,
            message: data.message
        });
    });

    socket.on('disconnect', () => {
        waitingQueue = waitingQueue.filter(user => user.id !== socket.id);
    });
});

// CRITICAL: Bind to 0.0.0.0 and Render's assigned process.env.PORT
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});