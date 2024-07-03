#pragma once

#include "barretenberg/common/log.hpp"
#include "barretenberg/crypto/merkle_tree/indexed_tree/indexed_tree.hpp"
#include "msgpack/v3/sbuffer_decl.hpp"
#include <memory>
#include <napi.h>

#include <chrono>
#include <thread>
#include <utility>

namespace bb::world_state {

using namespace Napi;

using tree_op_callback = std::function<void(msgpack::sbuffer&)>;

class TreeOp : public AsyncWorker {
  public:
    TreeOp(Napi::Env env, tree_op_callback& callback)
        : AsyncWorker(env)
        , _callback(callback)
        , _deferred(env)
    {}

    TreeOp(Napi::Env env, Promise::Deferred& deferred, tree_op_callback& callback)
        : AsyncWorker(env)
        , _callback(callback)
        , _deferred(deferred)
    {}

    TreeOp(Napi::Env env, tree_op_callback callback)
        : AsyncWorker(env)
        , _callback(std::move(callback))
        , _deferred(env)
    {}

    TreeOp(Napi::Env env, Promise::Deferred& deferred, tree_op_callback callback)
        : AsyncWorker(env)
        , _callback(std::move(callback))
        , _deferred(deferred)
    {}

    TreeOp(const TreeOp&) = delete;
    TreeOp& operator=(const TreeOp&) = delete;
    TreeOp(TreeOp&&) = delete;
    TreeOp& operator=(TreeOp&&) = delete;

    ~TreeOp() override = default;

    void Execute() override
    {
        try {
            _callback(_result);
        } catch (const std::exception& e) {
            SetError(e.what());
        }
    }

    void OnOK() override { _deferred.Resolve(Napi::Buffer<char>::Copy(Env(), _result.data(), _result.size())); }
    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

    Promise GetPromise() { return _deferred.Promise(); }

  private:
    tree_op_callback _callback;
    Promise::Deferred _deferred;
    msgpack::sbuffer _result;
};

} // namespace bb::world_state
