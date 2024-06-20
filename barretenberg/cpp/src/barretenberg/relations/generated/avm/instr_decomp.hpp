
#pragma once
#include "../../relation_parameters.hpp"
#include "../../relation_types.hpp"
#include "./declare_views.hpp"

namespace bb::Avm_vm {

template <typename FF> struct Instr_decompRow {
    FF instr_decomp_indirect{};
    FF instr_decomp_o1{};
    FF instr_decomp_o2{};
    FF instr_decomp_o3{};
    FF instr_decomp_o4{};
    FF instr_decomp_o5{};
    FF instr_decomp_o6{};
    FF instr_decomp_o7{};
    FF instr_decomp_opcode_val{};
    FF instr_decomp_sel_decomposition{};
    FF instr_decomp_tag{};

    [[maybe_unused]] static std::vector<std::string> names();
};

inline std::string get_relation_label_instr_decomp(int index)
{
    switch (index) {}
    return std::to_string(index);
}

template <typename FF_> class instr_decompImpl {
  public:
    using FF = FF_;

    static constexpr std::array<size_t, 11> SUBRELATION_PARTIAL_LENGTHS{
        2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    };

    template <typename ContainerOverSubrelations, typename AllEntities>
    void static accumulate(ContainerOverSubrelations& evals,
                           const AllEntities& new_term,
                           [[maybe_unused]] const RelationParameters<FF>&,
                           [[maybe_unused]] const FF& scaling_factor)
    {

        // Contribution 0
        {
            Avm_DECLARE_VIEWS(0);

            auto tmp = ((instr_decomp_sel_decomposition - instr_decomp_sel_decomposition) - FF(0));
            tmp *= scaling_factor;
            std::get<0>(evals) += tmp;
        }
        // Contribution 1
        {
            Avm_DECLARE_VIEWS(1);

            auto tmp = ((instr_decomp_opcode_val - instr_decomp_opcode_val) - FF(0));
            tmp *= scaling_factor;
            std::get<1>(evals) += tmp;
        }
        // Contribution 2
        {
            Avm_DECLARE_VIEWS(2);

            auto tmp = ((instr_decomp_indirect - instr_decomp_indirect) - FF(0));
            tmp *= scaling_factor;
            std::get<2>(evals) += tmp;
        }
        // Contribution 3
        {
            Avm_DECLARE_VIEWS(3);

            auto tmp = ((instr_decomp_tag - instr_decomp_tag) - FF(0));
            tmp *= scaling_factor;
            std::get<3>(evals) += tmp;
        }
        // Contribution 4
        {
            Avm_DECLARE_VIEWS(4);

            auto tmp = ((instr_decomp_o1 - instr_decomp_o1) - FF(0));
            tmp *= scaling_factor;
            std::get<4>(evals) += tmp;
        }
        // Contribution 5
        {
            Avm_DECLARE_VIEWS(5);

            auto tmp = ((instr_decomp_o2 - instr_decomp_o2) - FF(0));
            tmp *= scaling_factor;
            std::get<5>(evals) += tmp;
        }
        // Contribution 6
        {
            Avm_DECLARE_VIEWS(6);

            auto tmp = ((instr_decomp_o3 - instr_decomp_o3) - FF(0));
            tmp *= scaling_factor;
            std::get<6>(evals) += tmp;
        }
        // Contribution 7
        {
            Avm_DECLARE_VIEWS(7);

            auto tmp = ((instr_decomp_o4 - instr_decomp_o4) - FF(0));
            tmp *= scaling_factor;
            std::get<7>(evals) += tmp;
        }
        // Contribution 8
        {
            Avm_DECLARE_VIEWS(8);

            auto tmp = ((instr_decomp_o5 - instr_decomp_o5) - FF(0));
            tmp *= scaling_factor;
            std::get<8>(evals) += tmp;
        }
        // Contribution 9
        {
            Avm_DECLARE_VIEWS(9);

            auto tmp = ((instr_decomp_o6 - instr_decomp_o6) - FF(0));
            tmp *= scaling_factor;
            std::get<9>(evals) += tmp;
        }
        // Contribution 10
        {
            Avm_DECLARE_VIEWS(10);

            auto tmp = ((instr_decomp_o7 - instr_decomp_o7) - FF(0));
            tmp *= scaling_factor;
            std::get<10>(evals) += tmp;
        }
    }
};

template <typename FF> using instr_decomp = Relation<instr_decompImpl<FF>>;

} // namespace bb::Avm_vm