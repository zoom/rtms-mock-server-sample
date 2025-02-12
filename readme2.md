# Realtime Media Streams  Mock Server

> **Confidential under NDA - Do Not Distribute**<br/>
> The information in this document is confidential and requires an NDA. It is intended only for partners in the Zoom RTMS Beta Developers program. Participation in the RTMS Beta Offering, including access to and use of these RTMS Beta Offering materials, is subject to Zoom’s [Beta Program - Terms of Use](https://www.zoom.com/en/trust/beta-terms-and-conditions/?optimizely_user_id=2a2f4ff424d63a314b7536ade4a8c12d&amp_device_id=5039ff16-4ae8-42dc-bf77-49268ac0d6ff&_ics=1733334737195).

This is a mock server that simulates the WebSocket-based streaming of Zoom's Realtime Media Streams (RTMS). It provides a complete development and testing environment for client-server interactions, including media streaming, signaling, and webhook management.

Documentation: [Realtime Media Streams - Beta Developer Documentation](https://drive.google.com/file/d/1UDfgOisarScdSRx0BwuzNU6dkNjaHXsA/view?usp=sharing)

Video guide: [Testing the RTMS mock server](https://success.zoom.us/clips/share/kTCgY9H3TDGyKabbHELfhg)

## Test client

A companion test client is available at [./client.js](https://github.com/zoom/rtms-mock-server-sample/blob/main/client.js) to help test this mock server. The client implements all necessary protocols and provides a user interface for testing different streaming scenarios.

Test client features: 
- Webhook endpoint implementation
- WebSocket connection handling
- Media streaming controls
- Incoming real time data logs

## Installation & setup

This app requires [FFmpeg](https://github.com/FFmpeg/FFmpeg) and [Node.js version 14]() or higher.

The app can be run locally by cloning and installing packages with npm or on [Docker](https://www.docker.com/).


## Usage 

## Contributing


