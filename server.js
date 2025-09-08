const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client } = require('ssh2');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const cors = require('cors');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // 100 MB
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));

// Store SSH connections per socket
const sshConnections = new Map();
const connectionLogs = new Map();

// Multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(os.homedir(), 'SSH-File-Exchange', 'uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Helper function to get home directory based on OS
function getDefaultLocalPath() {
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
        return path.join(homeDir, 'Downloads');
    }
    return homeDir;
}

// Helper function to list local directory
async function listLocalDirectory(socket, dirPath) {
    try {
        console.log('Listing local directory:', dirPath);
        
        // Validate and normalize path
        let normalizedPath = path.normalize(dirPath);
        
        // Check if path exists
        const exists = await fs.access(normalizedPath).then(() => true).catch(() => false);
        if (!exists) {
            normalizedPath = getDefaultLocalPath();
            console.log('Path not found, using default:', normalizedPath);
        }

        const files = await fs.readdir(normalizedPath, { withFileTypes: true });
        const fileList = [];

        for (const file of files) {
            try {
                // Skip hidden files and system files
                if (file.name.startsWith('.') || file.name.startsWith('$')) continue;
                
                const filePath = path.join(normalizedPath, file.name);
                const stats = await fs.stat(filePath).catch(() => null);
                
                if (stats) {
                    fileList.push({
                        name: file.name,
                        type: file.isDirectory() ? 'directory' : 'file',
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        path: filePath,
                        permissions: stats.mode
                    });
                }
            } catch (err) {
                // Skip files we can't read
                console.error(`Skipping file ${file.name}:`, err.message);
            }
        }

        console.log(`Found ${fileList.length} items in ${normalizedPath}`);
        
        socket.emit('local-files', {
            path: normalizedPath,
            files: fileList,
            parent: path.dirname(normalizedPath)
        });
    } catch (error) {
        console.error('Error listing local directory:', error);
        socket.emit('error', { message: `Failed to list directory: ${error.message}` });
        
        // Try to send default directory if there's an error
        if (dirPath !== getDefaultLocalPath()) {
            console.log('Falling back to default directory');
            listLocalDirectory(socket, getDefaultLocalPath());
        }
    }
}

// Helper function to list remote directory
function listRemoteDirectory(socket, dirPath, log) {
    const conn = sshConnections.get(socket.id);
    
    if (!conn || !conn.sftpInstance) {
        socket.emit('error', { message: 'Not connected to SSH' });
        return;
    }

    const sftp = conn.sftpInstance;
    
    log(`Reading directory: ${dirPath}`, 'info');
    
    sftp.readdir(dirPath, (err, list) => {
        if (err) {
            log(`Failed to read directory: ${err.message}`, 'error');
            socket.emit('error', { message: 'Failed to list directory: ' + err.message });
            return;
        }

        const files = list.map(item => ({
            name: item.filename,
            type: item.longname[0] === 'd' ? 'directory' : 'file',
            size: item.attrs.size,
            modified: new Date(item.attrs.mtime * 1000).toISOString(),
            permissions: item.attrs.mode,
            path: path.join(dirPath, item.filename).replace(/\\/g, '/')
        }));

        log(`Found ${files.length} items in ${dirPath}`, 'success');
        
        socket.emit('remote-files', {
            path: dirPath,
            files: files,
            parent: path.dirname(dirPath)
        });
    });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Send initial setup info
    socket.emit('initial-setup', {
        platform: process.platform,
        defaultPath: getDefaultLocalPath()
    });

    // Log function for this connection
    const log = (message, type = 'info') => {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, message, type };
        
        if (!connectionLogs.has(socket.id)) {
            connectionLogs.set(socket.id, []);
        }
        connectionLogs.get(socket.id).push(logEntry);
        
        socket.emit('connection-log', logEntry);
        console.log(`[${socket.id}] ${message}`);
    };

    // Send initial local directory listing after connection
    setTimeout(() => {
        const defaultPath = getDefaultLocalPath();
        console.log('Sending initial local directory:', defaultPath);
        listLocalDirectory(socket, defaultPath);
    }, 100);

    // Handle SSH connection
    socket.on('ssh-connect', async (data) => {
        const { host, username, privateKey, port = 22 } = data;
        
        log(`Initiating SSH connection to ${username}@${host}:${port}`, 'info');
        
        const conn = new Client();
        
        conn.on('ready', () => {
            log('SSH connection established successfully', 'success');
            sshConnections.set(socket.id, conn);
            
            // Get SFTP instance
            conn.sftp((err, sftp) => {
                if (err) {
                    log(`SFTP initialization failed: ${err.message}`, 'error');
                    socket.emit('ssh-error', { error: err.message });
                    return;
                }
                
                log('SFTP session initialized', 'success');
                conn.sftpInstance = sftp;
                socket.emit('ssh-connected', { 
                    message: 'Connected successfully',
                    host,
                    username
                });
                
                // Load initial directory
                const initialPath = `/home/${username}`;
                log(`Loading initial directory: ${initialPath}`, 'info');
                listRemoteDirectory(socket, initialPath, log);
            });
        });

        conn.on('error', (err) => {
            log(`SSH connection error: ${err.message}`, 'error');
            socket.emit('ssh-error', { error: err.message });
        });

        conn.on('end', () => {
            log('SSH connection closed', 'info');
            sshConnections.delete(socket.id);
            socket.emit('ssh-disconnected');
        });

        conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
            log('Keyboard-interactive authentication requested', 'warning');
            finish([]);
        });

        // Connect
        try {
            log('Attempting to connect...', 'info');
            conn.connect({
                host: host,
                port: port,
                username: username,
                privateKey: privateKey,
                readyTimeout: 30000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                algorithms: {
                    serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-ed25519'],
                    cipher: ['aes128-gcm', 'aes128-gcm@openssh.com', 'aes256-gcm', 'aes256-gcm@openssh.com', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr']
                }
            });
        } catch (error) {
            log(`Connection failed: ${error.message}`, 'error');
            socket.emit('ssh-error', { error: error.message });
        }
    });

    // List remote directory
    socket.on('list-remote-dir', async (dirPath) => {
        const log = (msg, type) => socket.emit('connection-log', { 
            timestamp: new Date().toISOString(), 
            message: msg, 
            type 
        });
        listRemoteDirectory(socket, dirPath, log);
    });

    // List local directory
    socket.on('list-local-dir', async (dirPath) => {
        console.log('Request to list local directory:', dirPath);
        await listLocalDirectory(socket, dirPath);
    });

    // Get local drives (Windows only)
    socket.on('get-drives', async () => {
        if (process.platform === 'win32') {
            const drives = [];
            for (let i = 65; i <= 90; i++) {
                const drive = String.fromCharCode(i) + ':\\';
                if (fsSync.existsSync(drive)) {
                    drives.push(drive);
                }
            }
            socket.emit('drives-list', drives);
        } else {
            socket.emit('drives-list', ['/']);
        }
    });

    // Download file from remote to local
    socket.on('download-file', async (data) => {
        const { remotePath, localPath } = data;
        const conn = sshConnections.get(socket.id);
        
        if (!conn || !conn.sftpInstance) {
            socket.emit('error', { message: 'Not connected to SSH' });
            return;
        }

        const sftp = conn.sftpInstance;
        const fileName = path.basename(remotePath);
        
        try {
            // Get file stats first
            sftp.stat(remotePath, async (err, stats) => {
                if (err) {
                    socket.emit('error', { message: 'File not found: ' + err.message });
                    return;
                }

                const totalSize = stats.size;
                let downloaded = 0;

                // FIXED: Use the localPath provided by the client instead of hardcoded downloads folder
                const downloadPath = path.normalize(localPath);
                
                // Ensure the directory exists
                const downloadDir = path.dirname(downloadPath);
                await fs.mkdir(downloadDir, { recursive: true }).catch(() => {});

                console.log(`Downloading ${fileName} to ${downloadPath}`);

                // Download file with progress
                const readStream = sftp.createReadStream(remotePath);
                const writeStream = fsSync.createWriteStream(downloadPath);

                readStream.on('data', (chunk) => {
                    downloaded += chunk.length;
                    const progress = Math.round((downloaded / totalSize) * 100);
                    socket.emit('transfer-progress', { 
                        file: fileName,
                        progress: progress,
                        type: 'download',
                        downloaded,
                        total: totalSize
                    });
                });

                readStream.on('end', () => {
                    socket.emit('download-complete', { 
                        file: fileName,
                        localPath: downloadPath 
                    });
                    console.log(`Download complete: ${downloadPath}`);
                });

                readStream.on('error', (err) => {
                    socket.emit('error', { message: 'Download failed: ' + err.message });
                });

                readStream.pipe(writeStream);
            });
        } catch (error) {
            socket.emit('error', { message: 'Download failed: ' + error.message });
        }
    });

    // Upload file from local to remote
    socket.on('upload-file', async (data) => {
        const { localPath, remotePath, fileContent, fileName, fileSize } = data;
        const conn = sshConnections.get(socket.id);
        
        if (!conn || !conn.sftpInstance) {
            socket.emit('error', { message: 'Not connected to SSH' });
            return;
        }

        const sftp = conn.sftpInstance;
        
        try {
            let uploadPath = localPath;
            
            // If fileContent is provided (from browser), save it temporarily
            if (fileContent) {
                const tempDir = path.join(os.homedir(), 'SSH-File-Exchange', 'temp');
                await fs.mkdir(tempDir, { recursive: true });
                const tempPath = path.join(tempDir, Date.now() + '-' + fileName);
                
                // Convert base64 to buffer and save
                const buffer = Buffer.from(fileContent, 'base64');
                await fs.writeFile(tempPath, buffer);
                uploadPath = tempPath;
            }

            // Check if file exists
            const exists = await fs.access(uploadPath).then(() => true).catch(() => false);
            if (!exists) {
                socket.emit('error', { message: 'Local file not found' });
                return;
            }

            const stats = await fs.stat(uploadPath);
            const totalSize = stats.size;
            let uploaded = 0;

            // Upload file with progress
            const readStream = fsSync.createReadStream(uploadPath);
            const writeStream = sftp.createWriteStream(remotePath);

            readStream.on('data', (chunk) => {
                uploaded += chunk.length;
                const progress = Math.round((uploaded / totalSize) * 100);
                socket.emit('transfer-progress', { 
                    file: fileName || path.basename(remotePath),
                    progress: progress,
                    type: 'upload',
                    uploaded,
                    total: totalSize
                });
            });

            readStream.on('end', async () => {
                // Clean up temp file if created
                if (fileContent) {
                    await fs.unlink(uploadPath).catch(() => {});
                }
                
                socket.emit('upload-complete', { 
                    file: fileName || path.basename(remotePath)
                });

                // Refresh remote directory
                const dir = path.dirname(remotePath);
                const log = (msg, type) => socket.emit('connection-log', { 
                    timestamp: new Date().toISOString(), 
                    message: msg, 
                    type 
                });
                listRemoteDirectory(socket, dir, log);
            });

            readStream.on('error', (err) => {
                socket.emit('error', { message: 'Upload failed: ' + err.message });
            });

            writeStream.on('error', (err) => {
                socket.emit('error', { message: 'Upload failed: ' + err.message });
            });

            readStream.pipe(writeStream);
        } catch (error) {
            socket.emit('error', { message: 'Upload failed: ' + error.message });
        }
    });

    // Create remote directory
    socket.on('create-remote-dir', async (data) => {
        const { path: dirPath } = data;
        const conn = sshConnections.get(socket.id);
        
        if (!conn || !conn.sftpInstance) {
            socket.emit('error', { message: 'Not connected to SSH' });
            return;
        }

        const sftp = conn.sftpInstance;
        
        sftp.mkdir(dirPath, (err) => {
            if (err) {
                socket.emit('error', { message: 'Failed to create directory: ' + err.message });
            } else {
                socket.emit('dir-created', { path: dirPath });
                const log = (msg, type) => socket.emit('connection-log', { 
                    timestamp: new Date().toISOString(), 
                    message: msg, 
                    type 
                });
                listRemoteDirectory(socket, path.dirname(dirPath), log);
            }
        });
    });

    // Create local directory
    socket.on('create-local-dir', async (data) => {
        const { path: dirPath } = data;
        try {
            await fs.mkdir(dirPath, { recursive: true });
            socket.emit('dir-created', { path: dirPath });
            await listLocalDirectory(socket, path.dirname(dirPath));
        } catch (error) {
            socket.emit('error', { message: 'Failed to create directory: ' + error.message });
        }
    });

    // Delete remote file
    socket.on('delete-remote-file', async (data) => {
        const { path: filePath, type } = data;
        const conn = sshConnections.get(socket.id);
        
        if (!conn || !conn.sftpInstance) {
            socket.emit('error', { message: 'Not connected to SSH' });
            return;
        }

        const sftp = conn.sftpInstance;
        
        const deleteFunc = type === 'directory' ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);
        
        deleteFunc(filePath, (err) => {
            if (err) {
                socket.emit('error', { message: 'Failed to delete: ' + err.message });
            } else {
                socket.emit('file-deleted', { path: filePath });
                const log = (msg, type) => socket.emit('connection-log', { 
                    timestamp: new Date().toISOString(), 
                    message: msg, 
                    type 
                });
                listRemoteDirectory(socket, path.dirname(filePath), log);
            }
        });
    });

    // Delete local file
    socket.on('delete-local-file', async (data) => {
        const { path: filePath, type } = data;
        try {
            if (type === 'directory') {
                await fs.rmdir(filePath, { recursive: true });
            } else {
                await fs.unlink(filePath);
            }
            socket.emit('file-deleted', { path: filePath });
            await listLocalDirectory(socket, path.dirname(filePath));
        } catch (error) {
            socket.emit('error', { message: 'Failed to delete: ' + error.message });
        }
    });

    // Execute command
    socket.on('exec-command', async (command) => {
        const conn = sshConnections.get(socket.id);
        
        if (!conn) {
            socket.emit('error', { message: 'Not connected to SSH' });
            return;
        }

        conn.exec(command, (err, stream) => {
            if (err) {
                socket.emit('command-error', { error: err.message });
                return;
            }

            let output = '';
            
            stream.on('data', (data) => {
                output += data.toString();
                socket.emit('command-output', { data: data.toString() });
            });

            stream.stderr.on('data', (data) => {
                socket.emit('command-error', { error: data.toString() });
            });

            stream.on('close', (code) => {
                socket.emit('command-complete', { code, output });
            });
        });
    });

    // Clear logs
    socket.on('clear-logs', () => {
        connectionLogs.set(socket.id, []);
        socket.emit('logs-cleared');
    });

    // Disconnect SSH
    socket.on('ssh-disconnect', () => {
        const conn = sshConnections.get(socket.id);
        if (conn) {
            conn.end();
            sshConnections.delete(socket.id);
        }
        connectionLogs.delete(socket.id);
    });

    // Socket disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const conn = sshConnections.get(socket.id);
        if (conn) {
            conn.end();
            sshConnections.delete(socket.id);
        }
        connectionLogs.delete(socket.id);
    });
});

// REST API endpoint for file download
app.get('/api/download/:filename', async (req, res) => {
    try {
        const filePath = path.join(os.homedir(), 'SSH-File-Exchange', 'downloads', req.params.filename);
        res.download(filePath);
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});