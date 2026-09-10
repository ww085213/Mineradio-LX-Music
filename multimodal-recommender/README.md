# Mineradio 多模态个性化推荐

小M 的本地推荐链路会从当前队列、已载入歌单和本地音乐中收集候选歌曲：

1. `openai/clip-vit-base-patch32` 提取封面与偏好文本特征。
2. `laion/clap-htsat-unfused` 提取 10 秒音频片段与偏好文本特征。
3. 将封面相似度、音频相似度、收藏/歌单行为中心和元数据分数做可解释加权融合。
4. 将 Top-K 结果放入当前队列，仍由用户确认是否保存歌单。

模型和特征缓存只保存在本机。未安装 PyTorch 模型环境时，产品自动降级为行为 + 元数据排序，不影响播放器启动。

## 小M 长期记忆

小M 使用本机 `agent-memory.sqlite3` 作为持久化向量库，并以 `BAAI/bge-small-zh-v1.5` 生成中文语义 Embedding。每次请求前会从最多数千条历史记忆中召回相关内容，数据不会发送到独立的第三方记忆服务。

记忆分为 `short_term`、`context`、`episodic`、`preference`、`habit`、`profile` 与 `summary`。短期与情景记忆自动过期，经历类记忆参与时间衰减排序；偏好和画像长期保存。同一对象的新偏好会取代冲突旧值。积累 20 条未整理旧对话后会自动生成可检索摘要。

“清除对话记忆”只清理短期、情景与经历记忆，保留长期画像、偏好和习惯。完整清空必须通过后端接口显式提供 `scope=all` 与 `confirmed=true`。

## 启用完整模型

在 PowerShell 中运行：

```powershell
.\install-model.ps1 -CpuOnly
```

有可用 CUDA 环境时可省略 `-CpuOnly`。模型权重在第一次请求时由 Transformers 下载。

## 数据与评估

```powershell
python .\prepare_dataset.py "$env:APPDATA\Mineradio\local-music-library.json" .\songs.jsonl --feedback "$env:APPDATA\Mineradio\multimodal-recommendation-feedback.jsonl"
python .\evaluate.py .\ranking-eval.jsonl --k 5,10,20
```

评估输入每行包含 `query_id`、`candidate_id`、`label`、`score`（或 `rank`）。输出 Recall@K、NDCG@K 与 MRR。




