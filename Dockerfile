# Node.js 18
FROM node:18

# 作業ディレクトリ
WORKDIR /app

# 依存関係を先にコピーしてインストール
COPY package*.json ./
RUN npm install --production

# アプリのソースをコピー
COPY . .

# ポートは Cloud Run 標準の $PORT を利用
ENV PORT=8080
EXPOSE 8080

# アプリ起動
CMD ["npm", "start"]
