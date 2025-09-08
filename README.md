# SSH File Exchange Manager

A professional-grade, web-based file management system for seamless file transfers between local machines and remote SSH servers. Built with Node.js, Socket.IO, and SSH2.

![App](public/app_screen.png)

## Motivation

Managing files between local Windows machines and cloud-based Linux servers (like Hyperstack) can be frustrating. Traditional approaches require:
- Memorizing complex `scp` or `sftp` commands
- Uploading files to Google Drive then using `gdown` to pull them to the server
- Switching between multiple terminal windows
- Losing track of file locations across systems
- No visual feedback during transfers

This project was born from the need for a **simple, visual, and efficient** solution that makes remote file management as easy as dragging and dropping files on your local machine.

## Value Proposition

### Why This Tool Matters

1. **Zero Learning Curve**: No command-line expertise required. If you can use Windows Explorer, you can use this.

2. **Time Savings**: What previously took multiple steps (upload to cloud → copy link → SSH into server → wget/gdown → move to correct directory) now takes a single drag-and-drop action.

3. **Visual Confidence**: See exactly what files exist on both systems simultaneously. No more guessing or running `ls` commands repeatedly.

4. **Precise Control**: Download files directly to any local folder you're viewing, not just Downloads. Upload to exact remote directories without navigation commands.

5. **Real-time Feedback**: Progress bars, transfer speeds, and connection logs provide transparency into what's happening.

## Comparison with Traditional Tools

### Why Not Just Use WinSCP/FileZilla/Cyberduck?

You're right to ask - tools like WinSCP have existed for years. Here's where this project differs:

#### **Advantages of SSH File Exchange Manager**

1. **Web-Based, Zero Installation**: 
   - No software to install on every machine you use
   - Access from any computer with a browser
   - No admin rights required for installation
   - Works on any OS (Windows, Mac, Linux) without platform-specific versions

2. **Modern Development Stack**:
   - Built with Node.js and web technologies familiar to most developers
   - Easy to customize and extend with JavaScript
   - Can be integrated into existing web-based workflows
   - Simple to deploy on company servers or cloud platforms

3. **Lightweight & Fast**:
   - No heavy GUI framework overhead
   - Minimal resource usage
   - Quick startup time
   - No background services or system tray applications

4. **Developer-Friendly**:
   - Open source and hackable
   - Clear, simple codebase (~2300 lines total)
   - Easy to add custom features specific to your workflow
   - No proprietary formats or hidden configurations

5. **Cloud-Native Design**:
   - Can be hosted on a server for team access
   - Shareable sessions possible with WebRTC (future feature)
   - Browser-based means automatic updates for all users
   - No firewall/antivirus issues common with desktop applications

#### **When to Use Traditional Tools Instead**

To be fair, established tools like WinSCP excel in certain areas:

- **Advanced Features**: WinSCP offers scripting, synchronization, and integration with PuTTY
- **Stability**: Decades of development and bug fixes
- **Protocol Support**: FTP, FTPS, WebDAV, S3, and more beyond just SFTP
- **Power User Features**: Advanced file masks, custom commands, directory synchronization

#### **The Sweet Spot**

This tool is ideal for:
- Developers who want a quick, visual way to manage files on cloud servers
- Teams needing a shared, web-based file management solution
- Users who switch between multiple computers frequently
- Scenarios where installing desktop software is restricted or inconvenient
- People who prefer modern web UIs over traditional desktop applications
- Those who want to customize their file manager with familiar web technologies

**Think of it as**: The VS Code of file transfer tools - modern, web-based, extensible, and focused on developer experience rather than cramming in every possible feature.

## Features

### Core Functionality
- **Dual-panel interface** showing local and remote files simultaneously
- **Drag-and-drop transfers** in both directions
- **Real-time progress tracking** with visual progress bars
- **Breadcrumb navigation** for easy directory traversal
- **Multiple file selection** with Ctrl+Click
- **Context menus** for file operations (delete, rename, copy path)

### Professional Features
- **Connection monitoring** with detailed logs
- **Smart sorting** (by name, date, size, or type)
- **File type icons** for quick visual identification
- **Keyboard shortcuts** (F5 refresh, Ctrl+A select all, Delete)
- **Persistent SSH connections** with keep-alive
- **Error recovery** and automatic retries

### Security
- SSH key authentication only (no passwords)
- Keys stored in memory only during session
- Secure SFTP protocol for all transfers
- No credentials saved to disk

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)
- SSH private key file (.pem or .txt format)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ssh-file-exchange.git
cd ssh-file-exchange
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser:
```
http://localhost:3000
```

## Usage

### Initial Connection
1. Click **"Load SSH Key"** and select your private key file
2. Enter the server IP address (e.g., `149.36.0.178`)
3. Enter your username (e.g., `ubuntu`)
4. Click **"Connect"**

### File Operations

#### Uploading Files (Local → Remote)
- **Method 1**: Drag files from the local panel to the remote panel
- **Method 2**: Select files and click the upload button
- **Method 3**: Use the file picker to select multiple files

#### Downloading Files (Remote → Local)
- **Method 1**: Drag files from remote panel to local panel
- **Method 2**: Select files and click the download button
- Files download to your **current viewing directory**, not just Downloads

#### Navigation
- **Double-click** folders to enter them
- **Click breadcrumb items** to jump to parent directories
- **Use refresh button** to reload current directory

#### Sorting Files
- Click the **"Sort"** dropdown in either panel
- Choose from 7 sorting options
- Sort preferences persist during navigation

## Technical Architecture

### Backend (Node.js)
- **Express** for HTTP server
- **Socket.IO** for real-time bidirectional communication
- **SSH2** for SSH/SFTP connections
- **Multer** for file upload handling

### Frontend (Vanilla JavaScript)
- **Socket.IO Client** for real-time updates
- **Drag & Drop API** for intuitive file transfers
- **File API** for local file handling
- **CSS3** animations for smooth UI feedback

### Communication Flow
```
Browser ←→ Socket.IO ←→ Node.js Server ←→ SSH2/SFTP ←→ Remote Server
```

## Project Structure
```
ssh-file-exchange/
├── server.js           # Main server file with SSH handling
├── package.json        # Node.js dependencies
├── public/
│   └── index.html      # Complete frontend application
├── temp/               # Temporary upload storage
├── downloads/          # Optional download cache
└── README.md           # This file
```

## Configuration

### Server Port
Default: `3000`
```javascript
const PORT = process.env.PORT || 3000;
```

### File Size Limits
Default: `500MB`
```javascript
limits: { fileSize: 500 * 1024 * 1024 }
```

### SSH Connection Timeout
Default: `30 seconds`
```javascript
readyTimeout: 30000
```

## Troubleshooting

### Connection Issues
- **Verify SSH key format**: Should start with `-----BEGIN RSA PRIVATE KEY-----`
- **Check server accessibility**: Ensure port 22 is open
- **Confirm username**: Must match the server's user account

### File Transfer Issues
- **Large files**: Progress may appear stuck but transfer continues
- **Permission denied**: Ensure write permissions in target directory
- **Path not found**: Verify the directory exists on remote server

### Performance Tips
- Keep file panels to <1000 files for optimal performance
- Use sorting to quickly find files in large directories
- Close connection log when not needed to save resources

## Future Enhancements

Potential improvements for future versions:
- Multiple simultaneous server connections
- File search functionality
- Batch file operations
- File preview (text, images)
- Transfer queue management
- Bookmarked directories
- File compression before transfer
- Terminal integration in UI

## Acknowledgments

Built to solve real-world frustrations with cloud server file management, especially for ML/AI practitioners working with Hyperstack and similar cloud platforms.

---

**Note**: This tool significantly simplifies file management for remote servers but should be used responsibly. Always ensure you have proper authorization before connecting to any server.