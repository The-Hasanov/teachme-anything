"use strict";

function activate(context) {
    const lesson = require('./lesson-view').registerLessonView(context);
    return { lesson };
}

function deactivate() { }

module.exports = { activate, deactivate };
