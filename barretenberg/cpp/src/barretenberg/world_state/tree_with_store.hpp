#pragma once

#include <memory>

namespace bb::world_state {

template <typename Tree> struct TreeWithStore {
    std::unique_ptr<Tree> tree;
    std::unique_ptr<typename Tree::Store> store;
    std::unique_ptr<typename Tree::Store::PersistedStore> persisted_store;

    TreeWithStore(std::unique_ptr<Tree> t,
                  std::unique_ptr<typename Tree::Store> s,
                  std::unique_ptr<typename Tree::Store::PersistedStore> p)
        : tree(std::move(t))
        , store(std::move(s))
        , persisted_store(std::move(p))
    {}

    TreeWithStore(TreeWithStore&& other) noexcept
        : tree(std::move(other.tree))
        , store(std::move(other.store))
        , persisted_store(std::move(other.persisted_store))
    {}

    TreeWithStore(const TreeWithStore& other) = delete;
    ~TreeWithStore() = default;

    TreeWithStore& operator=(TreeWithStore&& other) = delete;
    TreeWithStore& operator=(const TreeWithStore& other) = delete;
};

} // namespace bb::world_state
