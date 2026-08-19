# 工具设计

工具接收工作区相对路径 `task_path`。候选工具还接收 `candidate_id`。模型不能提交任意 Shell 命令。

## 工具

- `prepare_baseline`：编译、验证、Benchmark 和 NCU 基线；
- `compile_cuda`：执行任务声明的 NVCC 命令；
- `validate_kernel`：执行正确性验证；
- `run_benchmark`：预热并采集多次延迟；
- `profile_kernel`：执行 NCU，保存报告并返回结构化指标；
- `apply_source_patch`：在隔离目录应用候选补丁；
- `evaluate_candidate`：根据已记录结果决定接受或拒绝。

## 补丁安全

`apply_source_patch` 只允许修改任务声明的文件。处理过程：

1. 创建候选目录和检查点；
2. 保存原始 Diff；
3. 修正 hunk 行数；
4. 要求旧上下文只匹配一个位置；
5. 应用失败时删除候选目录。

## 进程安全

所有子进程都使用：

- 固定工作目录；
- 参数数组；
- `shell: false`；
- 可执行文件白名单；
- 输出大小限制；
- 超时和取消信号；
- 退出码检查。

编译失败和正确性失败属于候选结果。路径、进程或协议错误会作为工具错误返回。
