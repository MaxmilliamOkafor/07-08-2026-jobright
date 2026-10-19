// Exposes React and ReactDOM as globals for mock-workday.js, which expects them.
import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
window.React = React;
window.ReactDOM = ReactDOMClient;
