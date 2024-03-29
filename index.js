// ==========================================
// OggyP Snake Web Socket Code

// (C) Copyright 2021 Oscar P. and other contributors.

// This document seeks to outline the server-side code that is responsible
// for handling connection, disconnection, movement and queuing. This
// document is not intended for front-end handling.

// Please do not copy this document without the permission of Oscar P.
// ==========================================


// INIT Web Socket

// Minimal amount of secure websocket server
var fs = require('fs');
var mysql = require('mysql');
const bcrypt = require('bcrypt'); //Importing the NPM bcrypt package.
const passwordSaltRounds = 10; //We are setting salt rounds, higher is safer.
const tokenSaltRounds = 5;

// Port where we'll run the websocket server
var webSocketsServerPort = 8444;

var WebSocketServer = require('ws').Server;
var ws = new WebSocketServer({
    port: webSocketsServerPort
});

// Get snake database user info
// Done to conceal the username and password
var userInfo = JSON.parse(fs.readFileSync('userInfo.txt', 'utf8'))

var con = mysql.createConnection({
    host: "localhost",
    user: userInfo.username,
    password: userInfo.password,
    database: "snake"
});

con.connect(function (err) {
    if (err) throw err;
    console.log("MYSQL Connected!");
});

// Import UUID
const { v4: uuidv4 } = require('uuid');

// ==========================================
// ==========================================

const startingInfo = [ // Location, direction
    [[0, 0], [0, 1]], // TOP LEFT
    [[159, 74], [0, -1]], // BOTTOM RIGHT
    [[0, 74], [0, -1]], // BOTTOM LEFT
    [[159, 0], [0, 1]], // TOP RIGHT
    [[0 + 39, 0], [0, 1]], // TOP LEFT MID
    [[159 - 39, 74], [0, -1]], // BOTTOM RIGHT
    [[0 + 39, 74], [0, -1]], // BOTTOM LEFT
    [[159 - 39, 0], [0, 1]], // TOP RIGHT
]

// Classes
class game {
    // player1_uuid, player2_uuid, uuid, player1_user_id, player2_user_id
    //NEW GAME UUID, PLAYERS [PLAYER UUID, PLAYER USER ID]
    // version is the specific "mode" 0 = normal, 1 = 'tron' like inifinite growth
    constructor(uuid, rated, players, version = 0) {
        console.log(11)
        this.player_left = [false];
        this.uuid = uuid
        this.tick = true
        this.version = version
        this.players = []
        for (let i = 0; i < players.length; i++) {
            console.log(startingInfo[i])
            this.players.push(new player(players[i][0], startingInfo[i][0], startingInfo[i][1], players[i][1], players[i][2]))
        }
        console.log(12)
        this.remaining = players.length
        // previous_remaining will show how many platers were remaining last tick
        // used to check if a draw has occoured this tick in 3 player rated.
        this.previous_remaining = players.length
        this.countdown = 15;
        this.start = false;
        this.food = null;
        this.running = true;
        this.left = [];
        this.rated = rated
        console.log(13)
    }

    player_uuids() {
        let uuids = [];
        for (let i = 0; i < this.players.length; i++) {
            uuids.push(this.players[i].uuid)
        }
        return uuids;
    }

    getRndInteger(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    player_list() {
        data = []
        for (let i = 0; i < this.players.length; i++) {
            data.push(this.players[i])
        }
        return data;
    }
}

class matchQueue {
    constructor(queuesList) {
        this.queueNames = []
        queuesList.forEach(queueItem => {
            // Name, player amount, rated, version
            this[queueItem[0]] = new queue(queueItem[1], queueItem[2], queueItem[3])
            this.queueNames.push(queueItem[0])
        })
    }
    leave(userUUID) {
        this.queueNames.forEach(name => {
            this[name].leave(userUUID)
        })
    }
}

class queue {
    constructor(playersMaxAmt, rated, mode) {
        this.maxPlayers = playersMaxAmt;
        this.rated = rated
        this.mode = mode
        this.waitingAmt = 0;
        this.uuid = uuidv4();
        console.log("Queue made | UUID: " + this.uuid + " | Player Amount: " + this.maxPlayers + " | Rated: " + this.rated + " | Version: " + this.mode)
    }
    sendAllPlayerList() {
        let currentPlayerList = [];
        for (let k = 1; k <= this.maxPlayers; k++) {
            if (this.hasOwnProperty("player" + k)) {
                currentPlayerList.push(user_about[this["player" + k][2]].username)
            }
        }
        for (let k = 1; k <= this.maxPlayers; k++) {
            if (this.hasOwnProperty("player" + k)) {
                sendToWs(this["player" + k][0], "queuingPlayers", currentPlayerList, [
                    ["maxPlayers", this.maxPlayers]
                ])
            }
        }

    }
    join(userWS, userUUID, userID) {
        console.log("User joined game | UUID: " + this.uuid + " | Player Amount: " + this.maxPlayers + " | Rated: " + this.rated + " | Version: " + this.mode)
        let userPlayer;
        for (let i = 1; i <= this.maxPlayers; i++) {
            if (!this.hasOwnProperty("player" + i)) {
                this["player" + i] = [userWS, userUUID, userID];
                this.waitingAmt++
                sendToWs(userWS, 'match', 'player wait', [])
                UUID_WS[userUUID][3] = true
                UUID_WS[userUUID][4] = this.uuid
                userPlayer = i - 1
                this.sendAllPlayerList()
                break;
            }
        }
        if (this.waitingAmt === this.maxPlayers) {
            console.log("Game full | UUID: " + this.uuid + " | Player Amount: " + this.maxPlayers + " | Rated: " + this.rated + " | Version: " + this.mode)
            let playerList = []
            console.log(1)
            for (let i = 1; i <= this.maxPlayers; i++) {
                playerList.push([this["player" + i][1], this["player" + i][2], user_about[this["player" + i][2]].rating3])
            }
            console.log(playerList)
            let newGame = new game(this.uuid, this.rated, playerList, this.mode)
            newGame.food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
            let meta = []
            meta.push(['player', 0])
            meta.push(['mode', this.maxPlayers])
            meta.push(['food', newGame.food])
            let playersInfo = []
            console.log(2)
            for (let j = 1; j <= this.maxPlayers; j++)
                playersInfo.push(user_about[this["player" + j][2]])

            meta.push(['players', playersInfo])

            for (let i = 1; i <= this.maxPlayers; i++) {
                meta[0][1]  = i
                sendToWs(this["player" + i][0], 'match', 'found', meta)
                UUID_WS[this["player" + i][1]][1] = true
                UUID_WS[this["player" + i][1]][3] = false
                delete this["player" + i]
            }
            console.log(3)
            active_games.push(this.uuid)
            games[this.uuid] = newGame
            this.waitingAmt = 0
            this.uuid = uuidv4();
            console.log(4)
        }
        return userPlayer;
    }
    leave(userUUID) {
        for (let i = 1; i <= this.maxPlayers; i++) {
            if (this.hasOwnProperty("player" + i) && this["player" + i][1] === userUUID) {
                this.waitingAmt--
                UUID_WS[this["player" + i][1]][3] = false
                delete this["player" + i]
                console.log("User deleted from game")
                this.sendAllPlayerList()
                break;
            }
        }
    }
}

class player {
    constructor(player_uuid, head, direction, user_id, startRating) {
        this.user_id = user_id;
        this.uuid = player_uuid;
        this.snake_body = []
        this.snake_head = head
        this.old_head;
        this.diedThisTick = false;
        this.direction = direction
        this.old_direction = direction
        this.food_countdown = 0;
        this.growing = false;
        this.dead = false;
        this.left = false;
        this.placement;
        this.alerted = false;
        this.collision_amt;
        this.rated = false;
        this.startRating = startRating;
    }
}

class user {
    constructor(user_id, rating2, username, title, rating3, rd2) {
        this.logged_in = true
        this.in_game = false
        this.title = title
        this.username = username
        this.rating2 = rating2
        this.rating3 = rating3
        this.user_id = user_id
        this.rd2 = rd2
    }
    ratingReliable() {
        if (this.rd2 < 200) {
            return true;
        } else {
            return false;
        }
    }
}

// Objects \ define
// winner is a 0 or 1, 0 = player1, 1 = player2 wins, 2 = draw
const calculateRating_2player = (winner, player1rating, player2rating, player1rd, player2rd) => {
    return new Promise((resolve, reject) => {
        let data = [];
        let player1result
        let player2result
        if (winner === 0) {
            //player 1 wins
            player1result = 1
            player2result = 0
        } else if (winner === 1) {
            //player 2 wins
            player1result = 0
            player2result = 1
        } else if (winner === 2) {
            //draw
            player1result = 0.5
            player2result = 0.5
        }
        let c = 37.5;

        let player1rdNew = Math.min((Math.sqrt((player1rd ** 2) + (c ** 2))), 350);
        let player2rdNew = Math.min((Math.sqrt((player2rd ** 2) + (c ** 2))), 350);
        let q = (Math.log(10)) / 400;
        let player1gRd = 1 / (Math.sqrt(1 + (((3 * q ** 2) * (player1rdNew ** 2)) / (Math.PI ** 2))));
        let player2gRd = 1 / (Math.sqrt(1 + (((3 * q ** 2) * (player2rdNew ** 2)) / (Math.PI ** 2))));
        let player1expectedScore = 1 / (1 + 10 ** ((player1gRd * (player1rating - player2rating)) / -400));
        let player2expectedScore = 1 / (1 + 10 ** ((player2gRd * (player2rating - player1rating)) / -400));
        let player1dSquared = 1 / (q ** 2 * player1gRd ** 2 * player1expectedScore * (1 - player1expectedScore));
        let player2dSquared = 1 / (q ** 2 * player2gRd ** 2 * player2expectedScore * (1 - player2expectedScore));

        player1rating = player1rating + (q / (1 / (player1rd ** 2)) + (1 / player1dSquared)) * (player1gRd * (player1result - player1expectedScore));
        player1rdNew = Math.sqrt(((1 / (player1rd ** 2)) + (1 / player1dSquared)) ** -1);
        player1rd = player1rdNew;

        player2rating = player2rating + (q / (1 / (player2rd ** 2)) + (1 / player2dSquared)) * (player2gRd * (player2result - player2expectedScore));
        player2rdNew = Math.sqrt(((1 / (player2rd ** 2)) + (1 / player2dSquared)) ** -1);
        player2rd = player2rdNew;

        data.push([player1rating, player1rd]);
        data.push([player2rating, player2rd]);

        resolve(data)
    })
}


const calc3playerRating = (ownRating, scoreVplayer1, player1rating, scoreVplayer2, player2rating) => {
    return new Promise((resolve, reject) => {
        // data is the new own rating
        var data = ownRating;
        expectedScore = 1 / (1 + 10 ** ((player1rating - ownRating) / 400))
        data += 32 * (scoreVplayer1 - expectedScore)
        expectedScore = 1 / (1 + 10 ** ((player2rating - data) / 400))
        data += 32 * (scoreVplayer2 - expectedScore)

        resolve(data)
    })
}

// Get tokens that are valid from the last week and store the user ids associated
var savedTokens = {}
con.query("SELECT user_id, token, tokenTime FROM users WHERE token IS NOT NULL AND tokenTime IS NOT NULL AND tokenTime >= curdate() - INTERVAL DAYOFWEEK(curdate())+6 DAY", function (err, results, fields) {
    if (err) throw err;
    if (results.length !== 0) {
        results.forEach(result => {
            savedTokens[result.user_id] = {}
            savedTokens[result.user_id].tokenHash = result.token
            savedTokens[result.user_id].time = result.tokenTime
        })
        console.log(results.length + " token(s) found.")
    } else {
        console.log("No valid tokens found")
    }
});

const default_rating = 1200;
const default_rating_deviation = 350;

// SERVER VERSION
const version = 7.1;
// =================
var private_games = {}
var games = {};
var CLIENTS = [];
var UUID_WS = {};
var WS_Message = {};
var user_about = {};
var active_games = [];
// open_3 = [game_uuid, [player1_uuid, user_id], [player2_uuid, user_id]]
var user_regex = new RegExp("^[0-9A-Za-z _.-]+$");
const x_box_amount = 160
const y_box_amount = 75
// 2d array matching idex of CLIENTS, [init, WS_ID, user id, username, chat_id, admin]

// first number indicates the amount of players
// If an R is there then it is rated
// If there is a v then it stands for version
var queues = [
    ["2pR", 2, true, 0],
    ["3pR", 3, true, 0],
    ["2pv1", 2, false, 1],
    ["3pv1", 3, false, 1],
    ["4pv1", 4, false, 1],
    ["2pv2", 2, false, 2],
    ["3pv2", 3, false, 2],
    ["4pv2", 4, false, 2]
]

for (let i = 2; i <= 8; i++ ) {
    queues.push([i + "p", i, false, 0],) // Unrated normal
    queues.push([i + "pv1", i, false, 1],) // Tron
    queues.push([i + "pv2", i, false, 2],) // Double Speed
}

var queueList = new matchQueue(queues)

function checkConnection(ws) {
    const isAlive = ws.readyState === ws.OPEN;
    if (!isAlive) {
        console.log(`Client ${ws.clientId} is not connected`);
        return ws.terminate();
    }
    ws.ping();
}

ws.on('connection', function (ws) {
    console.log('Client connection attempt')
    CLIENTS.push(ws);
    const UUID = uuidv4();
    var logged_in = false;
    var player;
    var user_id;
    var private_game_code;
    UUID_WS[UUID] = [ws, false, false, false, "", false]
    //ws, in game, private, in queue, game UUID
    sendToWs(ws, 'gameVersion', version, [
        ["modes", queues]
    ])
    // On message
    ws.on('message', function (message) {
        var game_uuid = UUID_WS[UUID][4]
        try {
            rec_msg = JSON.parse(message)
            if (UUID_WS[UUID][5]) {
                if (!UUID_WS[UUID][1] && !UUID_WS[UUID][2] && !UUID_WS[UUID][3]) {
                    if (rec_msg.type === 'match') {
                        console.log("Join Req")
                        if (rec_msg.content === 'random') {
                            if (queueList.hasOwnProperty(rec_msg.mode)) {
                                player = queueList[rec_msg.mode].join(ws, UUID, user_id)
                            }
                        } else if (rec_msg.content === 'new private') {
                            console.log('Private game')
                            UUID_WS[UUID][2] = true;
                            player = 0
                            private_game_code = getRndInteger(1000000, 9999999);
                            game_uuid = uuidv4();
                            UUID_WS[UUID][4] = game_uuid
                            private_games[private_game_code] = [UUID, game_uuid, user_id]
                            sendToWs(ws, 'match', 'private match wait', [
                                ['code', private_game_code]
                            ])
                            sendToWs(ws, "queuingPlayers", [user_about[user_id].username], [
                                ["maxPlayers", 2]
                            ])
                        } else if (rec_msg.content === 'find private') {
                            // game exists
                            console.log('find private game')
                            if (private_games.hasOwnProperty(rec_msg.code)) {
                                var found_priv_game = private_games[rec_msg.code]
                                console.log('Found private game')
                                player = 1
                                // player1_uuid, player2_uuid, uuid, player1_user_id, player2_user_id
                                //NEW GAME UUID, PLAYERS [PLAYER UUID, PLAYER USER ID]
                                //[UUID, game_uuid, user_id]
                                new_game = new game(found_priv_game[1], false, [
                                    [found_priv_game[0], found_priv_game[2]],
                                    [UUID, user_id]
                                ])
                                game_uuid = new_game.uuid;
                                UUID_WS[UUID][4] = game_uuid
                                new_game.food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
                                sendToWs(ws, 'match', 'found', [
                                    ['player', 2],
                                    ['food', new_game.food],
                                    ['players', [user_about[new_game.players[0].user_id], user_about[new_game.players[1].user_id]]]
                                ])
                                sendToWs(UUID_WS[new_game.players[0].uuid][0], 'match', 'found', [
                                    ['player', 1],
                                    ['food', new_game.food],
                                    ['players', [user_about[new_game.players[0].user_id], user_about[new_game.players[1].user_id]]]
                                ])
                                new_game.player_uuids().forEach(user_uuid_from_open_game => {
                                    const user_uuid = UUID_WS[user_uuid_from_open_game]
                                    user_uuid[1] = true
                                    user_uuid[2] = false
                                    user_uuid[3] = false
                                });
                                active_games.push(game_uuid)
                                games[game_uuid] = new_game
                                // delete private game listing
                                delete private_games[rec_msg.code]
                            } else {
                                sendToWs(ws, 'error', 'Invalid private game code', [])
                            }
                        }
                    } else if (rec_msg.type === 'rating') {
                        sendToWs(ws, 'rating', user_about[user_id].rating2, [
                            ['rating3', user_about[user_id].rating3],
                            ['reliable', user_about[user_id].ratingReliable()]
                        ])
                    } else if (rec_msg.type === 'logout') {
                        console.log("logout")
                        delete savedTokens[rec_msg.token.split('|')[1]]
                        sql = "UPDATE users SET token = NULL, tokenTime = NULL WHERE user_id = " + mysql.escape(rec_msg.token.split('|')[1]);
                        con.query(sql, function (err, register_insert_result) {
                            if (err) throw err;
                            sendToWs(ws, 'logout', '', [])
                        });
                    }
                } else {
                    if (rec_msg.type === 'movement' && UUID_WS[UUID][1]) {
                        let current_game = games[game_uuid];
                        if (current_game.players[player].direction !== JSON.stringify(rec_msg.content) && current_game.players[player].old_direction !== JSON.stringify(rec_msg.content)) {
                            //Math.abs(rec_msg.content[1]) === 1
                            if (rec_msg.content[0] === 0) {
                                // Y axis
                                if (rec_msg.content[1] * -1 !== current_game.players[player].old_direction[1]) {
                                    current_game.players[player].direction = [0, rec_msg.content[1]]
                                }
                                //Math.abs(rec_msg.content[0]) === 1
                            } else {
                                // X axis
                                if (rec_msg.content[0] * -1 !== current_game.players[player].old_direction[0]) {
                                    current_game.players[player].direction = [rec_msg.content[0], 0]
                                }
                            }
                        }
                    } else if (rec_msg.content === 'stop search') {
                        leaveQueue(UUID, private_game_code, 'client going to homepage')
                    }
                }
            } else {
                if (rec_msg.type === 'login') {
                    con.query("SELECT * FROM users WHERE username = " + mysql.escape(rec_msg.content), function (err, result, fields) {
                        if (err) throw err;
                        if (result.length === 1) {
                            bcrypt.compare(rec_msg.password, result[0].password_hash, function (error, response) {
                                if (response) {
                                    console.log(result[0].username + " logged in.")
                                    user_id = result[0].user_id
                                    if (user_about.hasOwnProperty(result[0].user_id)) {
                                        let oldUserWS = UUID_WS[user_about[result[0].user_id].uuid][0]
                                        sendToWs(oldUserWS, "error", "You have logged in somewhere else.", [])
                                        oldUserWS.close();
                                        console.log("Force logged out " + result[0].username + " | Logged in somewhere else.")
                                    }
                                    user_about[result[0].user_id] = new user(result[0].user_id, result[0].rating2, result[0].username, result[0].title, result[0].rating3, result[0].rd2)
                                    user_about[result[0].user_id].uuid = UUID
                                    user_about[result[0].user_id].logged_in = true
                                    UUID_WS[UUID][5] = true;
                                    generateToken(ws, user_id, result[0].username)
                                } else {
                                    sendToWs(ws, 'login', 'fail', [
                                        ['reason', 'Invaild password.']
                                    ])
                                }
                            });
                        } else {
                            sendToWs(ws, 'login', 'fail', [
                                ['reason', 'Invalid username.']
                            ])
                        }
                    });
                } else if (rec_msg.type === 'register') {
                    if (rec_msg.hasOwnProperty("content") && user_regex.test(rec_msg.content) && rec_msg.content.length <= 20 && rec_msg.content.length >= 3) {
                        register(rec_msg, ws)
                    } else {
                        sendToWs(ws, 'register', 'fail', [
                            ['reason', 'Only numbers, letters, hypens, periods, spaces and underscores are allowed for usernames. Maximum length is 20 characters. Min is 3']
                        ])
                    }
                } else if (rec_msg.type === 'token') {
                    var tokenInfo = rec_msg.content.split('|')
                    if (savedTokens.hasOwnProperty(tokenInfo[1])) {
                        var userID = tokenInfo[1]
                        console.log("User ID: " + userID + " hashed token: " + tokenInfo[0])
                        bcrypt.compare(tokenInfo[0], savedTokens[userID].tokenHash, function (error, response) {
                            if (response) {
                                con.query("SELECT * FROM users WHERE user_id = " + mysql.escape(userID) + " AND tokenTime >= curdate() - INTERVAL DAYOFWEEK(curdate())+7 DAY", function (err, result, fields) {
                                    if (err) throw err;
                                    if (result.length === 1) {
                                        console.log(result[0].username + " logged in.")
                                        user_id = result[0].user_id
                                        if (user_about.hasOwnProperty(result[0].user_id)) {
                                            let oldUserWS = UUID_WS[user_about[result[0].user_id].uuid][0]
                                            sendToWs(oldUserWS, "error", "You have logged in somewhere else.", [])
                                            oldUserWS.close();
                                            console.log("Force logged out " + result[0].username + " | Logged in somewhere else.")
                                        }
                                        user_about[result[0].user_id] = new user(result[0].user_id, result[0].rating2, result[0].username, result[0].title, result[0].rating3, result[0].rd2)
                                        user_about[result[0].user_id].uuid = UUID
                                        user_about[result[0].user_id].logged_in = true
                                        UUID_WS[UUID][5] = true;
                                        sendToWs(ws, 'login', 'success', [
                                            ["username", result[0].username]
                                        ])
                                    } else {
                                        sendToWs(ws, 'login', 'fail', [
                                            ['reason', 'Session expired, please login again.']
                                        ])
                                    }
                                });
                            } else {
                                sendToWs(ws, 'login', 'fail', [
                                    ['reason', 'Invaild Session.']
                                ])
                            }
                        });
                    } else {
                        sendToWs(ws, 'login', 'fail', [
                            ['reason', 'Invaild Session.']
                        ])
                    }
                }
            }
        } catch (e) {
            sendToWs(ws, 'error', 'Unknown Error has Occoured On OggyP Snake Servers. Please contact me about how this issue occoured', [])
            console.log(e)
        }
    });

    // Check connection every 2.5 seconds
    const interval = setInterval(() => {
        checkConnection(ws);
    }, 2500);

    // On close
    ws.on('close', function (client) {
        clearInterval(interval);

        var game_uuid = UUID_WS[UUID][4]
        const removed_user = CLIENTS.indexOf(ws);
        // Remove client from list of clients
        CLIENTS.splice(removed_user, 1);
        console.log("Client disconnected!");

        leaveQueue(UUID, private_game_code, 'client disconnected')

        if (UUID_WS[UUID][1]) {
            games[game_uuid].left.push(UUID)
        }
        // delete UUID_WS[UUID]
    });

    // On error
    ws.on('error', function (client) {
        clearInterval(interval);

        var game_uuid = UUID_WS[UUID][4]
        const removed_user = CLIENTS.indexOf(client);
        // Remove client from list of clients
        CLIENTS.splice(removed_user, 1);
        console.log("Client Error. Client has been dropped!");

        leaveQueue(UUID, private_game_code, 'client connection error')

        if (UUID_WS[UUID][1]) {
            games[game_uuid].left.push(UUID)
        }
        // delete UUID_WS[UUID]
    });
});

// ================================================================================
// GAME HANDLE
// ================================================================================

// FOR EACH GAME EVERY 0.1 SECONDS
setInterval(processGames, 25);

function processGames() {
    for (var k = 0; k < active_games.length; k++) {
        runGame(k)
    }
}

function runGame(k) {
    console.log('running game', k)
    let game_uuid = active_games[k]
    const cgame = games[game_uuid];
    if (cgame.running && (cgame.version === 2 || cgame.tick)) {
        cgame.tick = !cgame.tick
        var new_food = false;
        cgame.previous_remaining = cgame.remaining
        let uuids = cgame.player_uuids();
        if (cgame.left.length > 0) {
            console.log('Player Left')
            cgame.left.forEach(left_player_uuid => {
                cgame.players.forEach(player_to_check => {
                    if (left_player_uuid === player_to_check.uuid) {
                        if (!player_to_check.dead) {
                            player_to_check.placement = cgame.remaining
                            cgame.remaining--
                        }
                        player_to_check.dead = true
                        player_to_check.left = true
                        player_to_check.diedThisTick = true;
                    }
                });
            });
            cgame.left = []
        } else if (cgame.start !== true) {
            console.log('start', cgame.tick)
            if (!cgame.tick) {
                if (cgame.countdown > 0) {
                    // Countdown till game start
                    uuids.forEach(player_uuid => {
                        sendToWs(UUID_WS[player_uuid][0], 'countdown', cgame.countdown, [])
                    });
                    cgame.countdown -= 1;
                } else {
                    console.log(cgame.uuid + ' | game started')
                    cgame.start = true;
                    uuids.forEach(player_uuid => {
                        sendToWs(UUID_WS[player_uuid][0], 'countdown', 0, [])
                    });
                }
            }
        } else {
            // for each tick
            cgame.players.forEach(each_player => {
                if (each_player.diedThisTick) {
                    each_player.diedThisTick = false;
                }
                if (!each_player.dead) {
                    each_player.old_direction = each_player.direction.slice()
                    each_player.snake_body.push(each_player.snake_head.slice())
                    each_player.old_head = each_player.snake_head.slice()
                    each_player.snake_head = [each_player.snake_head[0] + each_player.old_direction[0], each_player.snake_head[1] + each_player.old_direction[1]]

                    if (each_player.food_countdown !== 0) {
                        each_player.food_countdown -= 1;
                    }

                    if (each_player.food_countdown === 0 && cgame.version !== 1) {
                        let dead_cell = each_player.snake_body.shift()
                    }

                    if (JSON.stringify(each_player.snake_head) === JSON.stringify(cgame.food)) {

                        var in_body = true
                        while (in_body) {
                            var to_be_food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
                            all_cells = []
                            cgame.players.forEach(food_each_player => {
                                all_cells = all_cells.concat(food_each_player.snake_body)
                            });
                            in_body = false;
                            cgame.players.forEach(item => {
                                if (JSON.stringify(item) === JSON.stringify(to_be_food)) {
                                    in_body = true;
                                }
                            });
                        }
                        cgame.food = to_be_food.slice()
                        new_food = true
                        each_player.food_countdown += 51;
                    }
                } else {
                    each_player.old_direction = [0, 0]
                }
            });

            all_cells = []
            cgame.players.forEach(food_each_player => {
                all_cells = all_cells.concat(food_each_player.snake_body)
            });

            // Check for win / loss
            cgame.players.forEach(player_to_check => {
                if (!player_to_check.dead) {
                    var collision_amt = 0
                    cgame.players.forEach(second_player_head => {
                        if (!second_player_head.dead) {
                            //if on top of each other
                            if (JSON.stringify(player_to_check.snake_head) == JSON.stringify(second_player_head.snake_head)) {
                                collision_amt++
                            }
                            // else if each snake went over the other
                            else if (JSON.stringify(player_to_check.snake_head) == JSON.stringify(second_player_head.old_head) && JSON.stringify(player_to_check.old_head) == JSON.stringify(second_player_head.snake_head)) {
                                console.log('Hit Heads - overtop')
                                collision_amt++
                            }
                        }
                    });

                    if (player_to_check.snake_head[0] < 0 || player_to_check.snake_head[1] < 0 || player_to_check.snake_head[0] >= x_box_amount || player_to_check.snake_head[1] >= y_box_amount) {
                        console.log('Out of border')
                        collision_amt++
                    }

                    all_cells.forEach(cell => {
                        if (JSON.stringify(cell) === JSON.stringify(player_to_check.snake_head)) {
                            console.log('Collision with body')
                            collision_amt++
                        }
                    });

                    player_to_check.collision_amt = collision_amt
                }
            });

            cgame.players.forEach(player_to_check => {
                // above 1 cus it thinks it is always hitting into its own head
                if (player_to_check.collision_amt > 1) {
                    console.log('Person died')
                    player_to_check.collision_amt = 0
                    player_to_check.dead = true;
                    player_to_check.diedThisTick = true;
                    player_to_check.placement = cgame.remaining
                    cgame.remaining--
                    sendToWs(UUID_WS[player_to_check.uuid][0], 'game alert', 'YOU DIED!', [
                        ['placement', player_to_check.placement]
                    ])
                }
            });

            if (cgame.remaining === 0) {
                var longestLength = 0;
                cgame.players.forEach(player_to_check => {
                    if (player_to_check.snake_body.length > longestLength && player_to_check.diedThisTick) {
                        longestLength = player_to_check.snake_body.length
                    }
                });

                var amountLongest = 0;
                cgame.players.forEach(player_to_check => {
                    if (player_to_check.snake_body.length === longestLength && player_to_check.diedThisTick) {
                        amountLongest++
                    }
                });

                if (amountLongest === 1) {
                    cgame.players.forEach(player_to_check => {
                        if (player_to_check.snake_body.length === longestLength && player_to_check.diedThisTick) {
                            player_to_check.dead = false;
                            cgame.remaining = 1;
                            console.log("snake ressurected")
                        }
                    });
                }
            }

            // update 3 player rated rating
            if (cgame.rated && cgame.previous_remaining !== cgame.remaining && cgame.mode === 3) {
                var dead_amt = cgame.previous_remaining - cgame.remaining
                cgame.players.forEach(player_to_check => {
                    if (player_to_check.dead && !player_to_check.rated && player_to_check.diedThisTick) {
                        player_to_check.rated = true;
                        var own_index = cgame.players.indexOf(player_to_check)
                        cgame.players.splice(own_index, 1)
                        // player died this tick
                        if (dead_amt === 3) {
                            console.log('All draw')
                            // then all should be 0.5
                            calc3playerRating(player_to_check.startRating, 0.5, cgame.players[0].startRating, 0.5, cgame.players[1].startRating)
                                .then(data => {
                                    update3Rating(player_to_check.user_id, data);
                                });
                        } else if (dead_amt === 2) {
                            console.log("Two draw")
                            // alive rating should be lost against, other player's rating should be tied against 
                            if (cgame.remaining === 1) {
                                // draw last
                                var deadPlayerID;
                                var alivePlayerID;
                                cgame.players.forEach(playerIndexToCheck => {
                                    if (!playerIndexToCheck.dead) {
                                        alivePlayerID = playerIndexToCheck.startRating;
                                    } else {
                                        deadPlayerID = playerIndexToCheck.startRating;
                                    }
                                });
                                calc3playerRating(player_to_check.startRating, 0.5, deadPlayerID, 0, alivePlayerID)
                                    .then(data => {
                                        update3Rating(player_to_check.user_id, data);
                                    });
                            } else {
                                // draw first
                                var loosingPlayer;
                                var drawPlayer;
                                cgame.players.forEach(playerIndexToCheck => {
                                    if (playerIndexToCheck.placement < 3) {
                                        drawPlayer = playerIndexToCheck.startRating;
                                    } else {
                                        loosingPlayer = playerIndexToCheck.startRating;
                                    }
                                });
                                calc3playerRating(player_to_check.startRating, 0.5, drawPlayer, 1, loosingPlayer)
                                    .then(data => {
                                        update3Rating(player_to_check.user_id, data);
                                    });
                            }

                        } else {
                            console.log('SINGLE PLAYER DIED 3 PLAYER RATED')
                            // only 1 player died this round 
                            if (cgame.remaining === 1) {
                                // came second
                                var deadPlayerID;
                                var alivePlayerID;
                                cgame.players.forEach(playerIndexToCheck => {
                                    if (!playerIndexToCheck.dead) {
                                        alivePlayerID = playerIndexToCheck.startRating;
                                    } else {
                                        deadPlayerID = playerIndexToCheck.startRating;
                                    }
                                });
                                calc3playerRating(player_to_check.startRating, 1, deadPlayerID, 0, alivePlayerID)
                                    .then(data => {
                                        update3Rating(player_to_check.user_id, data);
                                    });
                            } else {
                                // remaining is 2 so the player came last
                                calc3playerRating(player_to_check.startRating, 0, cgame.players[0].startRating, 0, cgame.players[1].startRating)
                                    .then(data => {
                                        //const calc3playerRating = (ownRating, scoreVplayer1, player1rating, scoreVplayer2, player2rating) 
                                        update3Rating(player_to_check.user_id, data);
                                    });
                            }
                        }
                    }
                });
            }

            // 1 player remaining (1 player wins)
            if (cgame.remaining === 1) {
                var winner;
                cgame.players.forEach(player_to_check => {
                    if (!player_to_check.dead && !player_to_check.left) {
                        sendToWs(UUID_WS[player_to_check.uuid][0], 'end', 'YOU WIN!', [])
                        winner = player_to_check
                    }
                });
                if (cgame.rated) {
                    // RATED CODE
                    if (cgame.mode === 3) {
                        var own_index = cgame.players.indexOf(winner)
                        cgame.players.splice(own_index, 1)
                        calc3playerRating(winner.startRating, 1, cgame.players[0].startRating, 1, cgame.players[1].startRating)
                            .then(data => {
                                update3Rating(winner.user_id, data);
                            });
                    }
                    if (cgame.mode === 2) {
                        if (!cgame.player[0].dead) {
                            calculateRating_2player(0, user_about[player1user_id].rating2, user_about[player2user_id].rating2, user_about[player1user_id].rd2, user_about[player2user_id].rd2)
                                .then(data => {
                                    updateRating(player1user_id, data[0]);
                                    updateRating(player2user_id, data[1]);
                                });
                        } else {
                            calculateRating_2player(1, user_about[player1user_id].rating2, user_about[player2user_id].rating2, user_about[player1user_id].rd2, user_about[player2user_id].rd2)
                                .then(data => {
                                    updateRating(player1user_id, data[0]);
                                    updateRating(player2user_id, data[1]);
                                });
                        }
                    }
                }
                cgame.players.forEach(player_to_check => {
                    if (!player_to_check.left) {
                        if (winner !== player_to_check && !player_to_check.left) {
                            sendToWs(UUID_WS[player_to_check.uuid][0], 'end', user_about[winner.user_id].username + ' won the game!', [])
                        }
                        UUID_WS[player_to_check.uuid][1] = false
                    }
                });
                cgame.running = false;
                const game_index = active_games.indexOf(game_uuid)
                active_games.splice(game_index, 1)
            }
            // draw so 0 players remaing (draw)
            else if (cgame.remaining < 1) {
                cgame.players.forEach(player_to_check => {
                    if (!player_to_check.left) {
                        sendToWs(UUID_WS[player_to_check.uuid][0], 'end', 'DRAW!', [])
                    }
                    UUID_WS[player_to_check.uuid][1] = false
                });
                if (cgame.rated) {
                    // draw
                    if (cgame.mode === 2) {
                        calculateRating_2player(2, user_about[player1user_id].rating2, user_about[player2user_id].rating2, user_about[player1user_id].rd2, user_about[player2user_id].rd2)
                            .then(data => {
                                updateRating(player1user_id, data[0]);
                                updateRating(player2user_id, data[1]);
                            });
                    }
                }
                cgame.running = false;
                const game_index = active_games.indexOf(game_uuid)
                active_games.splice(game_index, 1)
            }

            var meta = []
            if (new_food) {
                meta.push(['food', cgame.food])
            }
            let playersInfoList = []
            cgame.players.forEach(player_to_check => {
                playersInfoList.push([player_to_check.old_direction, player_to_check.snake_body.length, player_to_check.dead])
            });

            meta.push(['snakes', playersInfoList])

            uuids.forEach(player_uuid => {
                if (UUID_WS.hasOwnProperty(player_uuid)) {
                    sendToWs(UUID_WS[player_uuid][0], 'game', 'tick', meta)
                }
            });
        }
    } else if (cgame.running) {
        cgame.tick = !cgame.tick
    }
}

// functions
function sendToWs(ws, type, content, meta) {
    for (var member in WS_Message) delete WS_Message[member];
    if (meta.length > 0) {
        meta.forEach(element => {
            // element [name, thingo]
            WS_Message[element[0]] = element[1];
        });
    }
    WS_Message.type = type;
    WS_Message.content = content;
    ws.send(JSON.stringify(WS_Message));
}

function getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function updateRating(user_id, new_info) {
    var sql = "UPDATE users SET rating2 = " + mysql.escape(new_info[0]) + ", rd2 = " + mysql.escape(new_info[1]) + " WHERE user_id = " + mysql.escape(user_id);
    console.log(sql)
    con.query(sql, function (err, result) {
        if (err) throw err;
        user_about[user_id].rating2 = new_info[0];
        user_about[user_id].rd2 = new_info[1];
    });
}

function update3Rating(user_id, rating) {
    var sql = "UPDATE users SET rating3 = " + mysql.escape(rating) + " WHERE user_id = " + mysql.escape(user_id);
    console.log(sql)
    con.query(sql, function (err, result) {
        if (err) throw err;
        user_about[user_id].rating3 = rating;
    });
}

function sendAll(type, msg, meta) {
    for (var i = 0; i < CLIENTS.length; i++) {
        sendToWs(CLIENTS[i], type, msg, meta)
    }
}

function generateToken(ws, userID, username) {
    const token = uuidv4()
    bcrypt.hash(token, tokenSaltRounds, (err, hash) => {
        // Save Hashed Token to SQL
        var sql = "UPDATE users SET token = " + mysql.escape(hash) + ", tokenTime = sysdate() WHERE user_id = " + mysql.escape(userID);
        console.log(sql)
        con.query(sql, function (err, register_insert_result) {
            if (err) throw err;
            savedTokens[userID] = {}
            savedTokens[userID].tokenHash = hash
            savedTokens[userID].time = "Bruh this does nothing cus idk how SQL and JS time works help"
            sendToWs(ws, 'login', 'success', [
                ["token", token],
                ["username", username],
                ["userID", userID]
            ])
        });
    });
}

function verifyToken(ws, userID, clearToken, UUID) {

}

function register(msg, webSocketToSend) {
    con.query("SELECT * FROM users WHERE username = " + mysql.escape(msg.content), function (err, result, fields) {
        if (err) throw err;
        if (result.length > 0) {
            sendToWs(webSocketToSend, 'register', 'fail', [
                ['reason', 'That username is taken.']
            ])
        } else {
            bcrypt.hash(msg.password, passwordSaltRounds, (err, hash) => {
                var sql = "INSERT INTO users (username, password_hash, rating2, rating3, rd2, title) VALUES (" + mysql.escape(msg.content) + ", " + mysql.escape(hash) + ", " + mysql.escape(default_rating) + ", " + mysql.escape(default_rating) + ", " + mysql.escape(default_rating_deviation) + ", \"\")";
                console.log(sql)
                con.query(sql, function (err, register_insert_result) {
                    if (err) throw err;
                    sendToWs(webSocketToSend, 'register', 'success', [])
                    console.log("New user created");
                });
            });
        }
    });
}


function leaveQueue(user_UUID, private_game_code, reason) {
    if (UUID_WS[user_UUID][2]) {
        delete private_games[private_game_code]
        UUID_WS[user_UUID][2] = false
        console.log("Deleting private game - " + reason)
    } else if (UUID_WS[user_UUID][3]) {
        console.log("Leaving normal game - " + reason)
        queueList.leave(user_UUID)
    }
}