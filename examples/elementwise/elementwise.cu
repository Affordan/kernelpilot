#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <random>
#include <string>
#include <vector>

#define CUDA_CHECK(call) do { const cudaError_t error = (call); if (error != cudaSuccess) { std::cerr << cudaGetErrorString(error) << '\n'; std::exit(2); } } while (false)

extern "C" __global__ void elementwise_saxpy(const float* x, const float* y, float* output, float alpha, int size) {
  const int index = blockIdx.x * blockDim.x + threadIdx.x;
  if (index < size) output[index] = alpha * x[index] + y[index];
}

int main(int argc, char** argv) {
  constexpr int size = 1 << 22;
  constexpr int threads = 256;
  constexpr int blocks = (size + threads - 1) / threads;
  constexpr float alpha = 1.75f;
  std::vector<float> x(size);
  std::vector<float> y(size);
  std::mt19937 generator(11);
  std::uniform_real_distribution<float> distribution(-1.0f, 1.0f);
  for (int index = 0; index < size; ++index) { x[index] = distribution(generator); y[index] = distribution(generator); }

  float* device_x = nullptr;
  float* device_y = nullptr;
  float* device_output = nullptr;
  CUDA_CHECK(cudaMalloc(&device_x, x.size() * sizeof(float)));
  CUDA_CHECK(cudaMalloc(&device_y, y.size() * sizeof(float)));
  CUDA_CHECK(cudaMalloc(&device_output, x.size() * sizeof(float)));
  CUDA_CHECK(cudaMemcpy(device_x, x.data(), x.size() * sizeof(float), cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(device_y, y.data(), y.size() * sizeof(float), cudaMemcpyHostToDevice));
  elementwise_saxpy<<<blocks, threads>>>(device_x, device_y, device_output, alpha, size);
  CUDA_CHECK(cudaGetLastError());
  CUDA_CHECK(cudaDeviceSynchronize());

  const bool validate = argc > 1 && std::string(argv[1]) == "--validate";
  if (validate) {
    std::vector<float> output(size);
    CUDA_CHECK(cudaMemcpy(output.data(), device_output, output.size() * sizeof(float), cudaMemcpyDeviceToHost));
    double max_absolute = 0.0;
    double max_relative = 0.0;
    int mismatches = 0;
    for (int index = 0; index < size; ++index) {
      const double reference = static_cast<double>(alpha) * x[index] + y[index];
      const double absolute = std::abs(reference - output[index]);
      const double relative = absolute / std::max(std::abs(reference), 1e-12);
      max_absolute = std::max(max_absolute, absolute);
      max_relative = std::max(max_relative, relative);
      if (absolute > 1e-5 && relative > 1e-5) ++mismatches;
    }
    std::cout << "{\"max_absolute_error\":" << max_absolute
              << ",\"max_relative_error\":" << max_relative
              << ",\"mismatch_count\":" << mismatches << "}\n";
  } else {
    cudaEvent_t start;
    cudaEvent_t stop;
    CUDA_CHECK(cudaEventCreate(&start));
    CUDA_CHECK(cudaEventCreate(&stop));
    constexpr int iterations = 100;
    CUDA_CHECK(cudaEventRecord(start));
    for (int iteration = 0; iteration < iterations; ++iteration) {
      elementwise_saxpy<<<blocks, threads>>>(device_x, device_y, device_output, alpha, size);
    }
    CUDA_CHECK(cudaEventRecord(stop));
    CUDA_CHECK(cudaEventSynchronize(stop));
    float elapsed_ms = 0.0f;
    CUDA_CHECK(cudaEventElapsedTime(&elapsed_ms, start, stop));
    std::cout << "{\"latency_ms\":" << elapsed_ms / iterations << "}\n";
    CUDA_CHECK(cudaEventDestroy(start));
    CUDA_CHECK(cudaEventDestroy(stop));
  }
  CUDA_CHECK(cudaFree(device_output));
  CUDA_CHECK(cudaFree(device_y));
  CUDA_CHECK(cudaFree(device_x));
  return 0;
}

