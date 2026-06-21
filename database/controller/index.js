"use strict";

const userDataCtrl = require("./userData.js");
const threadsDataCtrl = require("./threadsData.js");
const globalDataCtrl = require("./globalData.js");

/**
 * Attach global DB helpers so any file can use:
 *   global.GoatBot.DB.userData(uid)
 *   global.GoatBot.DB.threadsData(tid)
 *   global.GoatBot.DB.globalData.get(key)
 */
function attachGlobalDB() {
  global.GoatBot.DB = {
    userData: userDataCtrl.userData,
    threadsData: threadsDataCtrl.threadsData,
    globalData: globalDataCtrl,
    users: userDataCtrl,
    threads: threadsDataCtrl,
  };

  // Convenience top-level globals
  global.userData = userDataCtrl.userData;
  global.threadsData = threadsDataCtrl.threadsData;
}

module.exports = {
  attachGlobalDB,
  userData: userDataCtrl,
  threadsData: threadsDataCtrl,
  globalData: globalDataCtrl,
};
