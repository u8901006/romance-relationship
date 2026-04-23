# Romance Relationship

> 浪漫關係與親密關係研究文獻日報 · 每日自動更新

## 關於

這個專案利用 **PubMed API** 抓取最新的浪漫關係、親密關係研究文獻，透過 **Zhipu AI (GLM-5-Turbo)** 進行摘要、分類與分析，自動生成精美的 HTML 日報並部署到 GitHub Pages。

## 涵蓋主題

- 浪漫吸引與約會
- 伴侶選擇與配對策略
- 依附關係與情感連結
- 親密關係滿意度、承諾與因應
- 婚姻、同居與離婚
- 分手、拒絕、嫉妒與不忠
- 伴侶治療與關係介入
- 約會暴力與親密伴侶暴力
- 親密關係的神經生物學與心理生理學
- LGBTQ+ 浪漫關係

## 技術架構

- **Node.js 24** 執行環境
- **PubMed E-utilities API** 抓取文獻
- **Zhipu AI GLM-5-Turbo** 分析與摘要（fallback: GLM-4.7 → GLM-4.7-Flash）
- **GitHub Actions** 每日 20:30 (UTC+8) 定時執行
- **GitHub Pages** 自動部署

## 授權

本專案生成的日報內容僅供學術研究參考，文獻版權歸原作者及期刊所有。
