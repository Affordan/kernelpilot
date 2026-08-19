#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#include <vector>

#define CUDA_CHECK(call) do { const cudaError_t error = (call); if (error != cudaSuccess) { std::cerr << cudaGetErrorString(error) << '\n'; std::exit(2); } } while (false)

extern "C" __global__ void reduce_sum(const float* input, float* partial, int size) {
  extern __shared__ float values[];
  const unsigned int thread = threadIdx.x;
  const unsigned int index = blockIdx.x * blockDim.x + thread;
  values[thread] = index < static_cast<unsigned int>(size) ? input[index] : 0.0f;
  __syncthreads();
  for (unsigned int stride = blockDim.x / 2; stride > 0; stride >>= 1) {
    if (thread < stride) values[thread] += values[thread + stride];
    __syncthreads();
  }
  if (thread == 0) partial[blockIdx.x] = values[0];
}

int main(int argc, char** argv) {
  constexpr int size = 1 << 20;
  constexpr int threads = 256;
  constexpr int blocks = (size + threads - 1) / threads;
  std::vector<float> host(size);
  std::mt19937 generator(7);
  std::uniform_real_distribution<float> distribution(-1.0f, 1.0f);
  for (float& value : host) value = distribution(generator);

  float* device_input = nullptr;
  float* device_partial = nullptr;
  CUDA_CHECK(cudaMalloc(&device_input, host.size() * sizeof(float)));
  CUDA_CHECK(cudaMalloc(&device_partial, blocks * sizeof(float)));
  CUDA_CHECK(cudaMemcpy(device_input, host.data(), host.size() * sizeof(float), cudaMemcpyHostToDevice));

  reduce_sum<<<blocks, threads, threads * sizeof(float)>>>(device_input, device_partial, size);
  CUDA_CHECK(cudaGetLastError());
  CUDA_CHECK(cudaDeviceSynchronize());

  const bool validate = argc > 1 && std::string(argv[1]) == "--validate";
  if (validate) {
    std::vector<float> partial(blocks);
    CUDA_CHECK(cudaMemcpy(partial.data(), device_partial, partial.size() * sizeof(float), cudaMemcpyDeviceToHost));
    double reference = 0.0;
    for (float value : host) reference += static_cast<double>(value);
    double actual = 0.0;
    for (float value : partial) actual += static_cast<double>(value);
    const double absolute = std::abs(reference - actual);
    const double relative = absolute / std::max(std::abs(reference), 1e-12);
    std::cout << "{\"max_absolute_error\":" << absolute
              << ",\"max_relative_error\":" << relative
              << ",\"mismatch_count\":" << (absolute <= 0.05 || relative <= 1e-4 ? 0 : 1) << "}\n";
  } else {
    cudaEvent_t start;
    cudaEvent_t stop;
    CUDA_CHECK(cudaEventCreate(&start));
    CUDA_CHECK(cudaEventCreate(&stop));
    constexpr int iterations = 100;
    CUDA_CHECK(cudaEventRecord(start));
    for (int iteration = 0; iteration < iterations; ++iteration) {
      reduce_sum<<<blocks, threads, threads * sizeof(float)>>>(device_input, device_partial, size);
    }
    CUDA_CHECK(cudaEventRecord(stop));
    CUDA_CHECK(cudaEventSynchronize(stop));
    float elapsed_ms = 0.0f;
    CUDA_CHECK(cudaEventElapsedTime(&elapsed_ms, start, stop));
    std::cout << "{\"latency_ms\":" << elapsed_ms / iterations << "}\n";
    CUDA_CHECK(cudaEventDestroy(start));
    CUDA_CHECK(cudaEventDestroy(stop));
  }
  CUDA_CHECK(cudaFree(device_partial));
  CUDA_CHECK(cudaFree(device_input));
  return 0;
}

