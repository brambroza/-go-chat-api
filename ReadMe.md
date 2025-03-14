upstream my_chat_service_backend {
    server 172.17.0.2:3000;
    server 172.17.0.3:3000;
    # ... 
}

server {
    listen 80;
    server_name mychat.domain.com;

    location / {
        proxy_pass http://my_chat_service_backend;
    }
}


echo "# -go-chat-api" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/brambroza/-go-chat-api.git
git push -u origin main

