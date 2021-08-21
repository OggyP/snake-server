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
var https = require('https');
var mysql = require('mysql');
const bcrypt = require('bcrypt');               //Importing the NPM bcrypt package.
const saltRounds = 10;                          //We are setting salt rounds, higher is safer.

// read ssl certificate
var privateKey = fs.readFileSync('/etc/letsencrypt/live/snake.oggyp.com/privkey.pem', 'utf8');
var certificate = fs.readFileSync('/etc/letsencrypt/live/snake.oggyp.com/fullchain.pem', 'utf8');

var credentials = { key: privateKey, cert: certificate };
//pass in your credentials to create an https server

// Port where we'll run the websocket server
var webSocketsServerPort = 8444;

var httpsServer = https.createServer(credentials);
httpsServer.listen(webSocketsServerPort, function() {
  console.log((new Date()) + " Server is listening on port "
      + webSocketsServerPort);
});

var WebSocketServer = require('ws').Server;
const { Cipher } = require('crypto');
const { SSL_OP_NO_TLSv1_1 } = require('constants');
var wss = new WebSocketServer({
    server: httpsServer
});

// Get snake database user info
// This is done to conceal the username and password
var userInfo = JSON.parse(fs.readFileSync('userInfo.txt', 'utf8'))

var con = mysql.createConnection({
  host: "localhost",
  user: userInfo.username,
  password: userInfo.password,
  database: "snake"
});

con.connect(function(err) {
  if (err) throw err;
  console.log("MYSQL Connected!");
});

// ==========================================
// ==========================================

// Classes
class game {
  // player1_uuid, player2_uuid, uuid, player1_user_id, player2_user_id
  //NEW GAME UUID, PLAYERS [PLAYER UUID, PLAYER USER ID]
  // version is the specific "mode" 0 = normal, 1 = 'tron' like inifinite growth
  constructor(uuid, rated, players, version = 0) {
    this.player_left = [false];
    this.uuid = uuid
    this.tick = true
    this.version = version
    this.mode = players.length
    this.player1 = new player(players[0][0], [0, 0], [0, 1], players[0][1])
    this.player2 = new player(players[1][0], [159, 74], [0, -1], players[1][1])
    if (players.length > 2) {
      this.player3 = new player(players[2][0], [0, 74], [0, -1], players[2][1])
    }
    if (players.length > 3) {
      this.player4 = new player(players[3][0], [159, 0], [0, 1], players[3][1])
    }
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
  }

  player_uuids() {
    let uuids = [];
    uuids.push(this.player1.uuid)
    uuids.push(this.player2.uuid)
    if (this.player3 != null) {
      uuids.push(this.player3.uuid)
    }
    if (this.player4 != null) {
      uuids.push(this.player4.uuid)
    }
    return uuids;
  }

  getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1) ) + min;
  }

  player_list() {
    data = [this.player1, this.player2]
    if (this.player3 != null) {
      data.push(this.player3)
    }
    if (this.player4 != null) {
      data.push(this.player4)
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
    this.uuid = createUUID();
    console.log("Queue made | UUID: " + this.uuid + " | Player Amount: " +  this.maxPlayers + " | Rated: " +  this.rated + " | Version: " +  this.mode)
  }
  join(userWS, userUUID, userID) {
    console.log("User joined game | UUID: " +  this.uuid + " | Player Amount: " +  this.maxPlayers + " | Rated: " +  this.rated + " | Version: " +  this.mode)
    let userPlayer;
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (!this.hasOwnProperty("player" + i)) {
        this["player" + i] = [userWS, userUUID, userID];
        this.waitingAmt ++
        sendToWs(userWS, 'match', 'player wait', [])
        UUID_WS[userUUID][3] = true
        UUID_WS[userUUID][4] = this.uuid
        userPlayer = "player" + i
        break;
      }
    }
    if (this.waitingAmt === this.maxPlayers) {
      console.log("Game full | UUID: " + this.uuid + " | Player Amount: " + this.maxPlayers + " | Rated: " + this.rated + " | Version: " + this.mode)
      let playerList = []
      for (let i = 1; i <= this.maxPlayers; i++) {
        playerList.push([this["player" + i][1], this["player" + i][2]])
      }
      let newGame = new game(this.uuid, this.rated, playerList, this.mode)
      newGame.food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
      let meta = []
      meta.push(['player', 0])
      meta.push(['mode', this.maxPlayers])
      meta.push(['food', newGame.food])
      for (let j = 1; j <= this.maxPlayers; j++) {
        meta.push(['player' + j, JSON.stringify(user_about[this["player" + j][2]])])
      }
      for (let i = 1; i <= this.maxPlayers; i++) {
        meta[0][1] = i
        sendToWs(this["player" + i][0], 'match', 'found', meta)
        UUID_WS[this["player" + i][1]][1] = true
        UUID_WS[this["player" + i][1]][3] = false
        delete this["player" + i]
      }
      active_games.push(this.uuid)
      games[this.uuid] = newGame
      this.waitingAmt = 0
      this.uuid = createUUID();
    }
    return userPlayer;
  }
  leave(userUUID) {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.hasOwnProperty("player" + i) && this["player" + i][1] === userUUID) {
        this.waitingAmt --
        UUID_WS[this["player" + i][1]][3] = false
        delete this["player" + i]
        console.log("User deleted from game, new JSON:")
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
      }
      else if (winner === 1) {
          //player 2 wins
          player1result = 0
          player2result = 1
      }
      else if (winner === 2) {
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
      let player1dSquared = 1 / (q ** 2 * player1gRd ** 2 * player1expectedScore * (1 -  player1expectedScore));
      let player2dSquared = 1 / (q ** 2 * player2gRd ** 2 * player2expectedScore * (1 -  player2expectedScore));

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
    expectedScore = 1/(1+10**((player1rating - ownRating)/400))
    data += 32*(scoreVplayer1 - expectedScore)
    expectedScore = 1/(1+10**((player2rating - data)/400))
    data += 32*(scoreVplayer2 - expectedScore)

    resolve(data)
  })
}

const default_rating = 1200;
const default_rating_deviation = 350;

const version = 1.0;
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
var queues = [["2pR", 2, true, 0], ["3pR", 3, true, 0], ["2p", 2, false, 0], ["3p", 3, false, 0], ["4p", 4, false, 0], ["2pv1", 2, false, 1], ["3pv1", 3, false, 1], ["4pv1", 4, false, 1], ["2pv2", 2, false, 2], ["3pv2", 3, false, 2], ["4pv2", 4, false, 2]]
var queueList = new matchQueue(queues)

wss.on('connection', function(ws){
  console.log('Client connection attempt')
  CLIENTS.push(ws);
  const UUID = createUUID();
  var logged_in = false;
  var player;
  var user_id;
  var private_game_code;
  UUID_WS[UUID] = [ws, false, false, false, ""]
              //ws, in game, private, in queue, game UUID
  sendToWs(ws, 'gameVersion', version, ["modes", queues])
  // On message
  ws.on('message', function(message) {
    var game_uuid = UUID_WS[UUID][4]
    try {
      rec_msg = JSON.parse(message)
      if (!rec_msg.hasOwnProperty('password')) {
        console.log(rec_msg)
      }
      if (logged_in) {
        if (!UUID_WS[UUID][1] && !UUID_WS[UUID][2] && !UUID_WS[UUID][3]) {
          if (rec_msg.type === 'match') {
            if (rec_msg.content === 'random') {
              if (queueList.hasOwnProperty(rec_msg.mode)) {
                player = queueList[rec_msg.mode].join(ws, UUID, user_id)
              }
            }
            else if (rec_msg.content === 'new private') {
              console.log('Private game')
              UUID_WS[UUID][2] = true;
              player = 'player1'
              private_game_code = getRndInteger(1000000, 9999999);
              game_uuid = createUUID()
              UUID_WS[UUID][4] = game_uuid
              private_games[private_game_code] = [UUID, game_uuid, user_id]
              sendToWs(ws, 'match', 'private match wait', [['code', private_game_code]])
            }
            else if (rec_msg.content === 'find private') {
              // game exists
              console.log('find private game')
              if (private_games.hasOwnProperty(rec_msg.code)) {
                var found_priv_game = private_games[rec_msg.code]
                console.log('Found private game')
                player = 'player2'
                // player1_uuid, player2_uuid, uuid, player1_user_id, player2_user_id
                //NEW GAME UUID, PLAYERS [PLAYER UUID, PLAYER USER ID]
                //[UUID, game_uuid, user_id]
                new_game = new game(found_priv_game[1], false, [[found_priv_game[0], found_priv_game[2]], [UUID, user_id]])
                game_uuid = new_game.uuid;
                UUID_WS[UUID][4] = game_uuid
                new_game.food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
                sendToWs(ws, 'match', 'found', [['player', 2], ['food', new_game.food], ['player1', JSON.stringify(user_about[new_game.player1.user_id])], ['player2',  JSON.stringify(user_about[new_game.player2.user_id])]])
                sendToWs(UUID_WS[new_game.player1.uuid][0], 'match', 'found', [['player', 1], ['food', new_game.food], ['player1', JSON.stringify(user_about[new_game.player1.user_id])], ['player2',  JSON.stringify(user_about[new_game.player2.user_id])]])
                new_game.player_uuids().forEach(user_uuid_from_open_game => {
                  const user_uuid =  UUID_WS[user_uuid_from_open_game]
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
            sendToWs(ws, 'rating', user_about[user_id].rating2, [['rating3', user_about[user_id].rating3], ['reliable', user_about[user_id].ratingReliable()]])
          }
        } else {
          if (rec_msg.type === 'movement') {
            let current_game = games[game_uuid];
            if (current_game[player].direction !== JSON.stringify(rec_msg.content) && current_game[player].old_direction !== JSON.stringify(rec_msg.content)) {
              //Math.abs(rec_msg.content[1]) === 1
              if (rec_msg.content[0] === 0 && Math.abs(rec_msg.content[1]) === 1) {
                // Y axis
                if (rec_msg.content[1] * -1 !== current_game[player].old_direction[1]) {
                  current_game[player].direction = [0, rec_msg.content[1]]
                }
                //Math.abs(rec_msg.content[0]) === 1
              } else if (Math.abs(rec_msg.content[0]) === 1) {
                // X axis
                if (rec_msg.content[0] * -1 !== current_game[player].old_direction[0]) {
                  current_game[player].direction = [rec_msg.content[0], 0]
                }
              }
            }
          }
          else if (rec_msg.content === 'stop search') {
            leaveQueue(UUID, private_game_code, 'client going to homepage')
          }
        }
      } else {
        if (rec_msg.type === 'login') {
          con.query("SELECT * FROM users WHERE username = " + mysql.escape(rec_msg.content), function (err, result, fields) {
            if (err) throw err;
            if (result.length === 1) {
              bcrypt.compare(rec_msg.password, result[0].password_hash, function(error, response) {
                if (response) {
                  console.log(result[0].username + " attempted to login.")
                  if (!user_about.hasOwnProperty(result[0].user_id)) {
                    user_id = result[0].user_id
                    user_about[user_id] = new user(user_id, result[0].rating2, result[0].username,  result[0].title, result[0].rating3, result[0].rd2)
                    logged_in = true;
                    sendToWs(ws, 'login', 'success', [])
                  } else if (!user_about[result[0].user_id].logged_in) {
                    user_id = result[0].user_id
                    user_about[user_id] = new user(user_id, result[0].rating2, result[0].username, result[0].title, result[0].rating3, result[0].rd2)
                    logged_in = true;
                    sendToWs(ws, 'login', 'success', [])
                  } else {
                    sendToWs(ws, 'login', 'fail', [['reason', 'You are already logged in.']])
                  }
                } else {
                  sendToWs(ws, 'login', 'fail', [['reason', 'Invaild password.']])
                }
              });
            } else {
              sendToWs(ws, 'login', 'fail', [['reason', 'Invalid username.']])
            }
          });
        }

        else if (rec_msg.type === 'register') {
          if (rec_msg.hasOwnProperty("content") && user_regex.test(rec_msg.content) && rec_msg.content.length < 100 && rec_msg.content.length >= 5) {
            register(rec_msg, ws)
          } else {
            sendToWs(ws, 'register', 'fail', [['reason', 'Only numbers, letters, hypens, periods, spaces and underscores are allowed for usernames. Maximum length is 100 characters. Min is 5']])
          }
        }
      }
    }
    catch (e) {}
  });

  // On close
  ws.on('close', function(client) {
    var game_uuid = UUID_WS[UUID][4]
    const removed_user = CLIENTS.indexOf(ws);
    // Remove client from list of clients
    CLIENTS.splice(removed_user, 1);
    console.log("Client disconnected!");

    leaveQueue(UUID, private_game_code, 'client disconnected')

    if (UUID_WS[UUID][1]) {
      games[game_uuid].left.push(UUID)
    }
    if (logged_in) {
      user_about[user_id].logged_in = false
    }
    // delete UUID_WS[UUID]
  });

  // On error
  ws.on('error', function(client) {
    var game_uuid = UUID_WS[UUID][4]
    const removed_user = CLIENTS.indexOf(client);
    // Remove client from list of clients
    CLIENTS.splice(removed_user, 1);
    console.log("Client Error. Client has been dropped!");

    leaveQueue(UUID, private_game_code, 'client connection error')

    if (UUID_WS[UUID][1]) {
      games[game_uuid].left.push(UUID)
    }
    if (logged_in) {
      user_about[user_id].logged_in = false
    }
    // delete UUID_WS[UUID]
  });
});

// ================================================================================
// GAME HANDLE
// ================================================================================

// FOR EACH GAME EVERY 0.1 SECONDS
setInterval(processGames, 50);

function processGames() {
  for (var k = 0; k < active_games.length; k++) {
    let game_uuid = active_games[k]
    const current_game = games[game_uuid];
    if (current_game.running && (current_game.version === 2 || current_game.tick)) {
      current_game.tick = !current_game.tick
      var player_list = [current_game.player1, current_game.player2]
      if (current_game.mode > 2) {
        player_list.push(current_game.player3)
      }
      if (current_game.mode > 3) {
        player_list.push(current_game.player4)
      }
      const player1user_id = current_game.player1.user_id
      const player2user_id = current_game.player2.user_id
      var new_food = false;
      current_game.previous_remaining = current_game.remaining
      let uuids = current_game.player_uuids();
      if (current_game.left.length > 0) {
        console.log('Player Left')
        current_game.left.forEach(left_player_uuid => {
          player_list.forEach(player_to_check => {
            if (left_player_uuid === player_to_check.uuid ) {
              if (!player_to_check.dead) {
                player_to_check.placement = current_game.remaining
                current_game.remaining --
              }
              player_to_check.dead = true
              player_to_check.left = true
              player_to_check.diedThisTick = true;
            }
          });
        });
        current_game.left = []
      }
      else if (current_game.start !== true) {
        if (current_game.countdown > 0) {
          // Countdown till game start
          uuids.forEach(player_uuid => {
            sendToWs(UUID_WS[player_uuid][0], 'countdown', current_game.countdown, [])
          });
          current_game.countdown -= 1;
        } else {
          console.log(current_game.uuid + ' | game started')
          current_game.start = true;
          uuids.forEach(player_uuid => {
            sendToWs(UUID_WS[player_uuid][0], 'countdown', 0, [])
          });
        }
      } else {
        // for each tick
        player_list.forEach(each_player => {
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

            if (each_player.food_countdown === 0 && current_game.version !== 1) {
              let dead_cell = each_player.snake_body.shift()
            }

            if (JSON.stringify(each_player.snake_head) === JSON.stringify(current_game.food)) {
              
              var in_body = true
              while (in_body) {
                var to_be_food = [getRndInteger(0, x_box_amount - 1), getRndInteger(0, y_box_amount - 1)]
                all_cells = []
                player_list.forEach(food_each_player => {
                  all_cells = all_cells.concat(food_each_player.snake_body)
                });
                in_body = false;
                all_cells.forEach(item => {
                  if (JSON.stringify(item) === JSON.stringify(to_be_food)) {
                    in_body = true;
                  }
                });
              }
              current_game.food = to_be_food.slice()
              new_food = true
              each_player.food_countdown += 51;
            }
          } else {
            each_player.old_direction = [0, 0]
          }
        });
        
        all_cells = []
        player_list.forEach(food_each_player => {
          all_cells = all_cells.concat(food_each_player.snake_body)
        });

        // Check for win / loss
        player_list.forEach(player_to_check => {
          if (!player_to_check.dead) {
            var collision_amt = 0
            player_list.forEach(second_player_head => {
              if (!second_player_head.dead) {
                //if on top of each other
                if (JSON.stringify(player_to_check.snake_head) == JSON.stringify(second_player_head.snake_head)) {
                  collision_amt ++
                }
                // else if each snake went over the other
                else if (JSON.stringify(player_to_check.snake_head) == JSON.stringify(second_player_head.old_head) && JSON.stringify(player_to_check.old_head) == JSON.stringify(second_player_head.snake_head)) {
                  console.log('Hit Heads - overtop')
                  collision_amt ++
                }
              }
            });

            if (player_to_check.snake_head[0] < 0 || player_to_check.snake_head[1] < 0 || player_to_check.snake_head[0] >= x_box_amount || player_to_check.snake_head[1] >= y_box_amount) {
              console.log('Out of border')
              collision_amt ++
            }

            all_cells.forEach(cell => {
              if (JSON.stringify(cell) === JSON.stringify(player_to_check.snake_head)) {
                console.log('Collision with body')
                collision_amt ++
              }
            });

            player_to_check.collision_amt = collision_amt
          }
        });

        player_list.forEach(player_to_check => {
          // above 1 cus it thinks it is always hitting into its own head
          if (player_to_check.collision_amt > 1) {
            console.log('Person died')
            player_to_check.collision_amt = 0
            player_to_check.dead = true;
            player_to_check.diedThisTick = true;
            player_to_check.placement = current_game.remaining
            current_game.remaining --
            sendToWs(UUID_WS[player_to_check.uuid][0], 'game alert', 'YOU DIED!', [['placement', player_to_check.placement]])
          }
        });

        if (current_game.remaining === 0) {
          var longestLength = 0;
          player_list.forEach(player_to_check => {
            if (player_to_check.snake_body.length > longestLength && player_to_check.diedThisTick) {
              longestLength = player_to_check.snake_body.length
            }
          });

          var amountLongest = 0;
          player_list.forEach(player_to_check => {
            if (player_to_check.snake_body.length === longestLength && player_to_check.diedThisTick) {
              amountLongest ++
            }
          });

          if (amountLongest === 1) {
            player_list.forEach(player_to_check => {
              if (player_to_check.snake_body.length === longestLength && player_to_check.diedThisTick) {
                player_to_check.dead = false;
                current_game.remaining = 1;
                console.log("snake ressurected")
              }
            });
          }
        }

        // update 3 player rated rating
        if (current_game.rated && current_game.previous_remaining !== current_game.remaining && current_game.mode === 3) {
          var dead_amt = current_game.previous_remaining - current_game.remaining
          player_list.forEach(player_to_check => {
            if (player_to_check.dead && !player_to_check.rated && player_to_check.diedThisTick) {
              player_to_check.rated = true;
              var all_players = [current_game.player1, current_game.player2, current_game.player3]
              var own_index = all_players.indexOf(player_to_check)
              all_players.splice(own_index, 1)
              // player died this tick
              if (dead_amt === 3) {
                console.log('All draw')
                // then all should be 0.5
                calc3playerRating(player_to_check.startRating, 0.5, all_players[0].startRating, 0.5, all_players[1].startRating)
                .then(data => {
                  update3Rating(player_to_check.user_id, data);
                });
              } else if (dead_amt === 2) {
                console.log("Two draw")
                // alive rating should be lost against, other player's rating should be tied against 
                if (current_game.remaining === 1) {
                  // draw last
                  var deadPlayerID;
                  var alivePlayerID;
                  all_players.forEach(playerIndexToCheck => {
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
                  all_players.forEach(playerIndexToCheck => {
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
                if (current_game.remaining === 1) {
                  // came second
                  var deadPlayerID;
                  var alivePlayerID;
                  all_players.forEach(playerIndexToCheck => {
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
                  calc3playerRating(player_to_check.startRating, 0, all_players[0].startRating, 0, all_players[1].startRating)
                  .then(data => {
                    update3Rating(player_to_check.user_id, data);
                  });
                }
              }
            }
          });
        }

        // 1 player remaining (1 player wins)
        if (current_game.remaining === 1) {
          var winner;
          player_list.forEach(player_to_check => {
            if (!player_to_check.dead && !player_to_check.left) {
              sendToWs(UUID_WS[player_to_check.uuid][0], 'end', 'YOU WIN!', [])
              winner = player_to_check
            }
          });
          if (current_game.rated) {
            // RATED CODE
            if (current_game.mode === 3) {
              var all_players = [current_game.player1, current_game.player2, current_game.player3]
              var own_index = all_players.indexOf(winner)
              all_players.splice(own_index, 1)
              calc3playerRating(winner.startRating, 1, all_players[0].startRating, 1, all_players[1].startRating)
              .then(data => {
                update3Rating(winner.user_id, data);
              });
            }
            if (current_game.mode === 2) {
              if (!current_game.player1.dead) {
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
          player_list.forEach(player_to_check => {
            if (!player_to_check.left) {
              if (winner !== player_to_check && !player_to_check.left) {
                sendToWs(UUID_WS[player_to_check.uuid][0], 'end', user_about[winner.user_id].username + ' won the game!', [])
              }
              UUID_WS[player_to_check.uuid][1] = false
            }
          });
          current_game.running = false;
          const game_index = active_games.indexOf(game_uuid)
          active_games.splice(game_index, 1)
        }
        // draw so 0 players remaing (draw)
        else if (current_game.remaining < 1) {
          player_list.forEach(player_to_check => {
            if (!player_to_check.left) {
              sendToWs(UUID_WS[player_to_check.uuid][0], 'end', 'DRAW!', [])
            }
            UUID_WS[player_to_check.uuid][1] = false
          });
          if (current_game.rated) {
            // draw
            if (current_game.mode === 2) {
              calculateRating_2player(2, user_about[player1user_id].rating2, user_about[player2user_id].rating2, user_about[player1user_id].rd2, user_about[player2user_id].rd2)
              .then(data => {
                updateRating(player1user_id, data[0]);
                updateRating(player2user_id, data[1]);
              });
            }
          }
          current_game.running = false;
          const game_index = active_games.indexOf(game_uuid)
          active_games.splice(game_index, 1)
        }

        var meta = []
        if (new_food) {
          meta.push(['food', current_game.food])
        }
        var player_num = 1
        player_list.forEach(player_to_check => {
          meta.push(['player' + player_num, [player_to_check.old_direction, player_to_check.snake_body.length, player_to_check.dead]])
          player_num ++
        });
        player_num = 0

        uuids.forEach(player_uuid => {
          if (UUID_WS.hasOwnProperty(player_uuid)) {
            sendToWs(UUID_WS[player_uuid][0], 'game', 'tick', meta)
          }
        });
      }
    } else if (current_game.running) {
      current_game.tick = !current_game.tick
    }
  }
}

// functions
function createUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
     var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
     return v.toString(16);
  });
}

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
  // console.log('Sent | ' + JSON.stringify(WS_Message))
}

function send_err_close(ws, error_msg) {
  sendToWs(ws, 'error', error_msg, [])
}

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1) ) + min;
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


function in2Darray(arr1, arr2) {
  arr1.forEach(item => {
    if (JSON.stringify(item) === JSON.stringify(arr2)) {
      return true;
    }
  });
  return false;
}

function register(msg, webSocketToSend) {
  con.query("SELECT * FROM users WHERE username = " + mysql.escape(msg.content), function (err, result, fields) {
    if (err) throw err;
    if (result.length > 0) {
      sendToWs(webSocketToSend, 'register', 'fail', [['reason', 'That username is taken.']])
    } else {
      bcrypt.hash(msg.password, saltRounds, (err, hash) => {
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
    UUID_WS[user_UUID][3] = false
    console.log("Deleting private game - " + reason)
  }
  else if (UUID_WS[user_UUID][3]) {
    console.log("Leaving normal game - " + reason)
    queueList.leave(user_UUID)
  }
}