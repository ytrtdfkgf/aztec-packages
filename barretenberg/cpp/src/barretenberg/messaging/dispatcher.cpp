#include "barretenberg/messaging/dispatcher.hpp"

using namespace bb::messaging;

bool MessageDispatcher::onNewData(msgpack::object& obj)
{
    bb::messaging::HeaderOnlyMessage header;
    obj.convert(header);

    auto iter = messageHandlers.find(header.msgType);
    if (iter == messageHandlers.end()) {
        std::cerr << "No registered handler for message of type " << header.msgType << std::endl;
        return true;
    }
    return (iter->second)(obj);
}

void MessageDispatcher::registerTarget(uint32_t msgType, std::function<bool(msgpack::object&)>& handler)
{
    messageHandlers.insert({ msgType, handler });
}
